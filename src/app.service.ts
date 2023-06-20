import { Injectable } from '@nestjs/common';
import * as regression from 'regression';
import * as sharp from "sharp";
import * as path from "node:path"

export interface ProcessingResponse {
	heatmapImageSourceName: string;
	grayscaleData: number[][];

}

@Injectable()
export class ImageProcessingService {

	private readonly STANDARDIZED_IMAGE_SIZE = 512
	private readonly NEIGHBORHOOD_SIZE = 128;
	private readonly SCALING_FACTOR = 2;
	private readonly MIN_BOX_SIZE = 2

	public async uploadFile(file: Express.Multer.File): Promise<ProcessingResponse> {
		const { data, info } = await sharp(`${file.destination}/${file.filename}`).greyscale().raw()
			.toBuffer({ resolveWithObject: true })

		const grayscalePixelArray = new Uint8ClampedArray(data.buffer)
		/**
		 * Each value at [i][j] represents the intensity of the gray color between 0 and 255
		 * This may be the only information needed to create the 3d plot on the UI side 
		 */
		const grayscaleImageMatrix: number[][] = this.toPixelMatrix(grayscalePixelArray, info.width);
		const squaredImagePixels = this.squareMatrix(grayscaleImageMatrix)
		const fractalDimensionMatrix: number[][] = this.getFractalDimensionMatrix(squaredImagePixels);
		// console.log("FD matrix", fractalDimensionMatrix)
		const heatmapImageSouceName: string = path.basename(await this.generateHeatmap(fractalDimensionMatrix))

		return <ProcessingResponse>{ heatmapImageSourceName: heatmapImageSouceName, grayscaleData: squaredImagePixels }
	}

	////////////////////////////////////////////**		 PRIVATE ZONE 		**/////////////////////////////////////////////////////

	/**
	 * 
	 * @param pixelMatrix 
	 * @returns a 512x512 matrix
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
				result[y][x] = this.calculateFractalDimension(imageMatrix, y, x)
			}
		}
		return result
	}

	private async generateHeatmap(matrix: number[][]): Promise<string> {
		return
	}



	private calculateFractalDimension(imageMatrix: number[][], centerX: number, centerY: number): number {
		const data: regression.DataPoint[] = [];
		const maxBoxSize: number = this.NEIGHBORHOOD_SIZE / 2;
		let neighborhood: number[][] = this.getNeighborhood(imageMatrix, centerX, centerY, this.NEIGHBORHOOD_SIZE);
		// console.log("Neighborhood size", `${neighborhood.length}x${neighborhood[0].length}`)

		for (let boxSize = this.MIN_BOX_SIZE; boxSize < maxBoxSize; boxSize *= this.SCALING_FACTOR) {
			let boxesCount: number = 0;
			// console.log(`BOX SIZE: ${boxSize}`)
			for (let i = 0; i < this.NEIGHBORHOOD_SIZE; i += boxSize) {
				for (let j = 0; j < this.NEIGHBORHOOD_SIZE; j += boxSize) {
					const boxPixels: number[] = this.getBoxPixels(neighborhood, i, j, boxSize)
					// console.log(`Box left corner (${j},${i})`, "\n", "Box Pixels", boxPixels)
					if (this.isBoxCountable(boxPixels, neighborhood[i][j])) {
						boxesCount++
					}
				}
			}
			const logBoxSize = Math.log(boxSize);
			const logBoxesCount = Math.log(boxesCount);
			data.push([logBoxSize, logBoxesCount]);
			// data.push([boxSize, boxesCount]);
		}
		// console.log("Points ", data)
		// return 0;
		const result = regression.linear(data);
		const fractalDimension = result.equation[0];
		return -fractalDimension;
	}


	private isBoxCountable(boxPixels: number[], mainPixel: number): boolean {
		return boxPixels.every(pixel => pixel !== 0)
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