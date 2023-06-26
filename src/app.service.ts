import { Injectable } from '@nestjs/common';
import * as regression from 'regression';
import * as sharp from "sharp";
import { HEATMAP_COLOR_PALETTE } from "./heatmap-color-palette";
import * as path from "path";
import * as fs from "fs"

export interface ProcessingResponse {
	heatmapImageSourceName: string;
	fractalDimensionMatrix: number[][];

}

@Injectable()
export class ImageProcessingService {

	private readonly STANDARDIZED_IMAGE_SIZE = 1024
	private readonly NEIGHBORHOOD_SIZE = 32;
	private readonly SCALING_FACTOR = 2;
	private readonly MIN_BOX_SIZE = 2
	private readonly THRESHOLD = 113

	public async processImage(file: Express.Multer.File): Promise<ProcessingResponse> {
		const { data, info } = await sharp(`${file.destination}/${file.filename}`).greyscale().raw()
			.toBuffer({ resolveWithObject: true })

		const grayscalePixelArray = new Uint8ClampedArray(data.buffer)
		/**
		 * Each value at [i][j] represents the intensity of the gray color between 0 and 255
		 * This may be the only information needed to create the 3d plot on the UI side 
		 */
		const grayscaleImageMatrix: number[][] = this.toPixelMatrix(grayscalePixelArray, info.width);
		const binarizedMatrix: number[][] = this.binarize(grayscaleImageMatrix)
		const squaredImagePixels: number[][] = this.squareMatrix(binarizedMatrix)
		// DEBUG - global fractal dimenison 
		// const fractalDimension: number = this.calculateFractalDimension(squaredImagePixels)
		// console.log("Global fractal dimension", fractalDimension)
		const fractalDimensionMatrix: number[][] = this.getFractalDimensionMatrix(squaredImagePixels);
		this.writeFractalDimensionMatrix(fractalDimensionMatrix)
		// console.log("FD matrix", fractalDimensionMatrix)
		const heatmapImageSouceName: string = path.basename(await this.generateHeatmap(fractalDimensionMatrix))

		return <ProcessingResponse>{ heatmapImageSourceName: heatmapImageSouceName, fractalDimensionMatrix: fractalDimensionMatrix }
	}

	////////////////////////////////////////////**		 PRIVATE ZONE 		**/////////////////////////////////////////////////////
	// DEBUG - global fractal dimension
	private calculateFractalDimension(imageMatrix: number[][]): number {
		const data: regression.DataPoint[] = [];
		const maxBoxSize: number = 64;

		for (let boxSize = this.MIN_BOX_SIZE; boxSize < maxBoxSize; boxSize *= this.SCALING_FACTOR) {
			let boxesCount: number = 0;
			for (let i = 0; i < this.STANDARDIZED_IMAGE_SIZE; i += boxSize) {
				for (let j = 0; j < this.STANDARDIZED_IMAGE_SIZE; j += boxSize) {
					const boxPixels: number[] = this.getBoxPixels(imageMatrix, i, j, boxSize)
					if (this.isBoxCountable(boxPixels, imageMatrix[i][j])) {
						boxesCount++
					}
				}
			}
			const logBoxSize = Math.log(boxSize);
			const logBoxesCount = Math.log(boxesCount) === -Infinity ? -0 : Math.log(boxesCount);
			data.push([logBoxSize, logBoxesCount]);
		}
		console.log("Points on the loglog graph ", data)
		const result = regression.linear(data);
		const fractalDimension = result.equation[0];
		return -fractalDimension;
	}

	private writeFractalDimensionMatrix(matrix: number[][]): void {
		const filename = 'matrice.txt';

		const matrixString = matrix.map(row => row.join(' ')).join('\n');

		try {
			fs.writeFileSync(filename, matrixString);
			console.log('Matricea a fost scrisă în fișierul', filename);
		} catch (err) {
			console.error('A apărut o eroare la scrierea fișierului:', err);
		}
	}


	/**
	 * 
	 * @param pixelMatrix 
	 * @returns a MxM matrix
	 */
	private squareMatrix(pixelMatrix: number[][]): number[][] {
		let matrixClone: number[][] = pixelMatrix.map(row => [...row])
		//HEIGHT
		if (pixelMatrix.length > this.STANDARDIZED_IMAGE_SIZE) {
			matrixClone = pixelMatrix.slice(0, this.STANDARDIZED_IMAGE_SIZE)
		} else {
			matrixClone = this.fillTheRows(pixelMatrix)
		}
		//WIDTH
		if (pixelMatrix[0].length > this.STANDARDIZED_IMAGE_SIZE) {
			matrixClone = matrixClone.map(row => row.slice(0, this.STANDARDIZED_IMAGE_SIZE))
		} else {
			let rowLength = pixelMatrix[0].length
			let missingRowLength = this.STANDARDIZED_IMAGE_SIZE - rowLength
			matrixClone = matrixClone.map(row => row.concat(new Array(missingRowLength).fill(0)))
		}
		return matrixClone
	}

	private fillTheRows(pixelMatrix: number[][]): number[][] {
		const rowLength: number = pixelMatrix[0].length
		const currentRowsCount: number = pixelMatrix.length
		let matrixClone: number[][] = pixelMatrix.map(row => [...row])
		let neededRowsCount: number = this.STANDARDIZED_IMAGE_SIZE - currentRowsCount
		while (neededRowsCount > 0) {
			matrixClone.push(new Array(rowLength).fill(0))
			neededRowsCount--;
		}
		return matrixClone
	}

	private toPixelMatrix(pixelArray: Uint8ClampedArray, width: number): number[][] {
		let matrix: number[][] = [];
		let startIndex = 0;
		while (pixelArray.length > startIndex) {
			const row: number[] = Array.from(pixelArray.slice(startIndex, startIndex + width))
			startIndex += width
			matrix.push(row)
		}
		return matrix
	}

	private getFractalDimensionMatrix(imageMatrix: number[][]): number[][] {
		let result: number[][] = this.initializeMatrix(imageMatrix[0].length, imageMatrix.length)
		for (let y = 0; y < imageMatrix.length; y++) {
			for (let x = 0; x < imageMatrix[0].length; x++) {
				result[y][x] = this.calculateLocalFractalDimension(imageMatrix, y, x)
			}
		}
		return result
	}

	private async generateHeatmap(matrix: number[][]): Promise<string> {
		const height = matrix.length;
		const width = matrix[0].length;
		const image = Buffer.alloc(width * height * 3); // 3 bytes per pixel (RGB)

		let i = 0;
		for (let row = 0; row < height; row++) {
			for (let col = 0; col < width; col++) {
				const value = matrix[row][col];
				const color = this.getColor(value);
				image[i++] = color[0]; // Red
				image[i++] = color[1]; // Green
				image[i++] = color[2]; // Blue
			}
		}
		const outputFilePath: string = `../box-counting-app-ui/src/assets/img-${Date.now().toString()}.png`
		await sharp(image, { raw: { width, height, channels: 3 } })
			.toFormat('png')
			.toFile(outputFilePath)
			.catch(() => { throw new Error("Heatmap creation failed") })
		return outputFilePath;
	}

	private getColor(value: number): number[] {
		if (value === 0) {
			return HEATMAP_COLOR_PALETTE["0"]
		} else if (value >= 0.10 && value <= 0.20) {
			return HEATMAP_COLOR_PALETTE["0.10"]
		} else if (value > 0.20 && value <= 0.30) {
			return HEATMAP_COLOR_PALETTE["0.20"]
		} else if (value > 0.30 && value <= 0.40) {
			return HEATMAP_COLOR_PALETTE["0.30"]
		} else if (value > 0.40 && value <= 0.50) {
			return HEATMAP_COLOR_PALETTE["0.40"]
		} else if (value > 0.50 && value <= 0.60) {
			return HEATMAP_COLOR_PALETTE["0.50"]
		} else if (value > 0.60 && value <= 0.70) {
			return HEATMAP_COLOR_PALETTE["0.60"]
		} else if (value > 0.70 && value <= 0.80) {
			return HEATMAP_COLOR_PALETTE["0.70"]
		} else if (value > 0.80 && value <= 0.90) {
			return HEATMAP_COLOR_PALETTE["0.80"]
		} else if (value > 0.90 && value < 1.0) {
			return HEATMAP_COLOR_PALETTE["1.90"]
		} else if (value >= 1.0 && value <= 1.10) {
			return HEATMAP_COLOR_PALETTE["1.10"]
		} else if (value > 1.10 && value <= 1.20) {
			return HEATMAP_COLOR_PALETTE["1.20"]
		} else if (value > 1.20 && value <= 1.30) {
			return HEATMAP_COLOR_PALETTE["1.30"]
		} else if (value > 1.30 && value <= 1.40) {
			return HEATMAP_COLOR_PALETTE["1.40"]
		} else if (value > 1.40 && value <= 1.50) {
			return HEATMAP_COLOR_PALETTE["1.50"]
		} else if (value > 1.50 && value <= 1.60) {
			return HEATMAP_COLOR_PALETTE["1.60"]
		} else if (value > 1.60 && value <= 1.70) {
			return HEATMAP_COLOR_PALETTE["1.70"]
		} else if (value > 1.70 && value <= 1.80) {
			return HEATMAP_COLOR_PALETTE["1.80"]
		} else if (value > 1.80 && value < 1.90) {
			return HEATMAP_COLOR_PALETTE["1.90"]
		} else {
			return HEATMAP_COLOR_PALETTE["2.00"]
		}
	}



	private binarize(imageMatrix: number[][]): number[][] {
		let matrixClone: number[][] = imageMatrix.map(row => [...row])
		for (let i = 0; i < imageMatrix.length; i++) {
			for (let j = 0; j < imageMatrix[0].length; j++) {
				if (matrixClone[i][j] > this.THRESHOLD) {
					matrixClone[i][j] = 1
				} else {
					matrixClone[i][j] = 0
				}
			}
		}
		return matrixClone
	}


	private calculateLocalFractalDimension(imageMatrix: number[][], centerX: number, centerY: number): number {
		const data: regression.DataPoint[] = [];
		const maxBoxSize: number = this.NEIGHBORHOOD_SIZE / 2;
		let neighborhood: number[][] = this.getNeighborhood(imageMatrix, centerX, centerY, this.NEIGHBORHOOD_SIZE);

		for (let boxSize = this.MIN_BOX_SIZE; boxSize < maxBoxSize; boxSize *= this.SCALING_FACTOR) {
			let boxesCount: number = 0;
			for (let i = 0; i < this.NEIGHBORHOOD_SIZE; i += boxSize) {
				for (let j = 0; j < this.NEIGHBORHOOD_SIZE; j += boxSize) {
					const boxPixels: number[] = this.getBoxPixels(neighborhood, i, j, boxSize)
					if (this.isBoxCountable(boxPixels, neighborhood[i][j])) {
						boxesCount++
					}
				}
			}
			const logBoxSize = Math.log(boxSize);
			const logBoxesCount = Math.log(boxesCount) === -Infinity ? 0 : Math.log(boxesCount);
			data.push([logBoxSize, logBoxesCount]);
		}
		const result = regression.linear(data);
		const fractalDimension = result.equation[0];
		// console.log((`${centerY},${centerX}) = ${-fractalDimension}`), "plot points", data)
		return -fractalDimension;
	}


	private isBoxCountable(boxPixels: number[], mainPixel: number): boolean {
		return boxPixels.some(pixel => pixel !== 0)
	}

	/**
	 * Returns a submatrix of the input matrix centered in (x,y) of dimension NxN where N is 
	 * represented by neighborhoodSize parameter. In case of overflowing its imageMatrix dimensions, the
	 * submatrix will be filled with zeros.
	*/
	private getNeighborhood(imageMatrix: number[][], x: number, y: number, neighborhoodSize: number): number[][] {
		const neighborhood = [];
		let halfSize = Math.floor(neighborhoodSize / 2);
		for (let i = x - halfSize; i <= x + halfSize - 1; i++) {
			const row = [];
			for (let j = y - halfSize; j <= y + halfSize - 1; j++) {
				if (i < 0 || j < 0 || i >= imageMatrix.length || j >= imageMatrix[0].length) {
					row.push(0)
				} else {
					row.push(imageMatrix[i][j]);
				}
			}
			neighborhood.push(row);
		}
		return neighborhood
	}

	private getBoxPixels(neighborhood: number[][], upMostY: number, leftMostX: number, boxSize: number): number[] {
		let result: number[] = []
		for (let rowCount = 0; rowCount < boxSize; rowCount++) {
			result.push(...neighborhood[upMostY].slice(leftMostX, leftMostX + boxSize))
			upMostY++
		}
		return result
	}

	private initializeMatrix(width: number, height: number): number[][] {
		let result = []
		for (let i = 0; i < height; i++) {
			result.push(new Array(width).fill(0))
		}
		return result
	}

}