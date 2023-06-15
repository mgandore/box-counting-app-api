import { Injectable } from '@nestjs/common';
import * as regression from 'regression';
import * as sharp from "sharp";
import { BUFFER_SAMPLE } from "./buffer.sample";
import * as path from "node:path"

export interface ProcessingResponse {
	heatmapImageSourceName: string;
	grayscaleData: number[][];

}

@Injectable()
export class ImageProcessingService {

	private readonly NEIGHBORHOOD_SIZE = 81; // 81 will be 3^4
	private readonly SCALING_FACTOR = 3; // of the boxes
	private readonly MIN_BOX_SIZE = 1

	public async uploadFile(file: Express.Multer.File): Promise<ProcessingResponse> {
		const { data, info } = await sharp(`${file.destination}/${file.filename}`).greyscale().raw()
			.toBuffer({ resolveWithObject: true })

		const grayscalePixelArray = new Uint8ClampedArray(data.buffer)
		/**
		 * Each value at [i][j] represents the intensity of the gray color between 0 and 255
		 * This may be the only information needed to create the 3d plot on the UI sie 
		 */
		const grayscaleImageMatrix: number[][] = this.toPixelMatrix(grayscalePixelArray, info.width);
		const fractalDimensionMatrix: number[][] = this.getFractalDimensionMatrix(grayscaleImageMatrix);
		// console.log("FD matrix", fractalDimensionMatrix)
		const heatmapImageSouceName: string = path.basename(await this.generateHeatmap(fractalDimensionMatrix))

		return <ProcessingResponse>{ heatmapImageSourceName: heatmapImageSouceName, grayscaleData: grayscaleImageMatrix }
	}

	////////////////////////////////////////////**		 PRIVATE ZONE 		**/////////////////////////////////////////////////////


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

	private getColor(value: number): [number, number, number] {
		const red = Math.round(255 * value);
		const blue = Math.round(255 * (1 - value));
		const green = 0;
		return [red, green, blue];
	}

	private calculateFractalDimension(imageMatrix: number[][], centerX: number, centerY: number): number {
		const data: regression.DataPoint[] = [];
		const maxBoxSize: number = this.NEIGHBORHOOD_SIZE / 2;
		let neighborhood: number[][] = this.getNeighborhood(imageMatrix, centerX, centerY, this.NEIGHBORHOOD_SIZE);
		// console.log("Neighborhood", neighborhood)
		neighborhood = this.binarizeWithOtsu(neighborhood)

		for (let boxSize = this.MIN_BOX_SIZE; boxSize <= maxBoxSize; boxSize *= this.SCALING_FACTOR) {
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
		return fractalDimension;
	}

	private binarizeWithOtsu(matrix: number[][]): number[][] {
		// Calculate histogram
		const histogram = new Array(256).fill(0);
		const totalPixels = matrix.length * matrix[0].length;

		for (let i = 0; i < matrix.length; i++) {
			for (let j = 0; j < matrix[0].length; j++) {
				const pixelValue = matrix[i][j];
				histogram[pixelValue]++;
			}
		}

		// Normalize histogram
		const normalizedHistogram = histogram.map(count => count / totalPixels);

		// Calculate cumulative sums
		let sum = 0;
		const cumulativeSum = normalizedHistogram.map((value) => {
			sum += value;
			return sum;
		});

		// Calculate between-class variance
		let maxVariance = 0;
		let threshold = 0;

		for (let t = 0; t < 256; t++) {
			const backgroundWeight = cumulativeSum[t];
			const foregroundWeight = 1 - backgroundWeight;

			const backgroundMean = cumulativeSum
				.slice(0, t + 1)
				.reduce((sum, value, index) => sum + index * normalizedHistogram[index], 0) / backgroundWeight;

			const foregroundMean = cumulativeSum
				.slice(t + 1)
				.reduce((sum, value, index) => sum + index * normalizedHistogram[index], 0) / foregroundWeight;

			const variance = backgroundWeight * foregroundWeight * Math.pow(backgroundMean - foregroundMean, 2);

			if (variance > maxVariance) {
				maxVariance = variance;
				threshold = t;
			}
		}

		// Binarize the matrix based on the threshold
		const binarizedMatrix = [];

		for (let i = 0; i < matrix.length; i++) {
			const row = [];
			for (let j = 0; j < matrix[0].length; j++) {
				const pixelValue = matrix[i][j];
				row.push(pixelValue > threshold ? 255 : 0);
			}
			binarizedMatrix.push(row);
		}
		return binarizedMatrix
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
		for (let i = x - halfSize; i <= x + halfSize; i++) {
			const row = [];
			for (let j = y - halfSize; j <= y + halfSize; j++) {
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