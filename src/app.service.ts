import { Injectable } from '@nestjs/common';
import * as sharp from "sharp";

@Injectable()
export class ImageProcessingService {
	getHello(): string {
		return 'Hello World!';
	}

	public async uploadFile(file: Express.Multer.File): Promise<Express.Multer.File> {
		const { data, info } = await sharp(`${file.destination}/${file.filename}`).grayscale().raw()
			.toBuffer({ resolveWithObject: true });

		const pixelArray = new Uint8ClampedArray(data.buffer);
		console.log(pixelArray)
		return file;
	}
}
