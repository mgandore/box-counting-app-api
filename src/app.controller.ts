import { Controller, Get, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ImageProcessingService as ImageProcessingService, ProcessingResponse } from './app.service';
import { FileInterceptor } from "@nestjs/platform-express";

@Controller()
export class AppController {
	public constructor(private readonly imageProcessingService: ImageProcessingService) { }

	@Post()
	@UseInterceptors(FileInterceptor("file"))
	public async uploadFile(@UploadedFile() file: Express.Multer.File): Promise<ProcessingResponse> {
		if (!file) {
			throw new Error("No file uploaded")
		}
		return this.imageProcessingService.uploadFile(file);
	}
}
