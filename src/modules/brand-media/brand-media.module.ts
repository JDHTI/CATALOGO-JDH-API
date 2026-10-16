import { Module } from '@nestjs/common';

import { SiteImageProcessorService } from '@modules/site-images/site-image-processor.service';

import { BrandMediaService } from './brand-media.service';

/**
 * Logos de marca (`brands/` en el bucket). Sin controlador a
 * propósito: el disparo es `pnpm brands:ingest`, solo local, y el frontend
 * lee `brands/manifest.json` directo del CDN (ver docs/brand-media.md).
 */
@Module({
  providers: [SiteImageProcessorService, BrandMediaService],
  exports: [BrandMediaService],
})
export class BrandMediaModule {}
