import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { CategorizationModule } from '@modules/categorization/categorization.module';

import { ProductsSyncService } from './products-sync.service';

/**
 * Sincronizaciones DWH → catálogo.
 * Sin controlador a propósito: no se expone ningún endpoint HTTP de sync
 * (no hay auth todavía). El disparo manual es `pnpm sync:products`.
 */
@Module({
  imports: [ScheduleModule.forRoot(), CategorizationModule],
  providers: [ProductsSyncService],
  exports: [ProductsSyncService],
})
export class SyncModule {}
