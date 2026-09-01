import { Module } from '@nestjs/common';

import { ImageProcessorService } from './image-processor.service';
import { ProductImagesService } from './product-images.service';

/**
 * Ingesta de imágenes de producto. Sin controlador a propósito: el disparo
 * es `pnpm images:ingest`, solo local (ver docs/product-images.md).
 * `PrismaService`/`StorageService`/`CacheService` son globales, no hace
 * falta importarlos.
 */
@Module({
  providers: [ImageProcessorService, ProductImagesService],
  exports: [ProductImagesService],
})
export class ProductImagesModule {}
