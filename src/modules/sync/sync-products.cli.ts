/**
 * Disparo manual de la sincronización de productos (carga inicial incluida):
 *
 *   pnpm sync:products
 *
 * Arranca un contexto standalone de Nest (sin servidor HTTP), ejecuta un
 * sync completo y termina. Requiere las variables DWH_* configuradas.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import { ProductsSyncService } from './products-sync.service';

async function main(): Promise<void> {
  const logger = new Logger('SyncProductsCli');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const summary = await app.get(ProductsSyncService).run();
    logger.log(
      `Sync #${summary.runId} OK: ${summary.totalRead} leídos, ` +
        `${summary.inserted} nuevos, ${summary.updated} actualizados, ` +
        `${summary.unchanged} sin cambios, ${summary.deactivated} desactivados`,
    );
  } catch (error) {
    logger.error(`Sincronización fallida: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
