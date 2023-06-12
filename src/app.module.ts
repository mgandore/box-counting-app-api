import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ImageProcessingService } from './app.service';
import { MulterModule } from "@nestjs/platform-express";

@Module({
  imports: [
    MulterModule.register({
      dest: '../data',
    }),
  ],
  controllers: [AppController],
  providers: [ImageProcessingService],
})
export class AppModule { }
