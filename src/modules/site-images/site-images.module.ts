import { Module } from '@nestjs/common';

import { SiteImageProcessorService } from './site-image-processor.service';
import { SiteImagesService } from './site-images.service';

/**
 * Imágenes generales del sitio (hero, banners). Sin controlador a propósito:
 * el disparo es `pnpm site-images:upload`, solo local (ver
 * docs/site-images.md). `StorageService` es global, no hace falta importarlo.
 */
@Module({
  providers: [SiteImageProcessorService, SiteImagesService],
  exports: [SiteImagesService],
})
export class SiteImagesModule {}
