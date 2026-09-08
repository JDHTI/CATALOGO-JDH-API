import { Module } from '@nestjs/common';

import { ProductContentService } from './product-content.service';

/**
 * Contenido editorial de producto. No expone endpoints de escritura: la
 * carga se ejecuta desde `pnpm product-content:import` después de una revisión.
 */
@Module({
  providers: [ProductContentService],
  exports: [ProductContentService],
})
export class ProductContentModule {}
