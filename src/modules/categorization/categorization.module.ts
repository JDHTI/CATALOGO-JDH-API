import { Module } from '@nestjs/common';

import { CategorizationService } from './categorization.service';

/**
 * Motor de categorización (taxonomía, reglas, asignaciones). Sin controlador:
 * lo expuesto al público es `CategoriesModule`; esto se opera por CLI y lo
 * dispara el sync. Ver docs/categorization.md.
 */
@Module({
  providers: [CategorizationService],
  exports: [CategorizationService],
})
export class CategorizationModule {}
