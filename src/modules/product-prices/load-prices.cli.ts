/**
 * Carga una lista de precios completa desde un archivo JSON:
 *
 *   pnpm prices:load <archivo.json> [--dry-run] [--force]
 *
 * Idempotente: upsert por (lista, SKU) y baja de los SKUs que ya no vienen.
 * `--dry-run` valida y reporta sin escribir; `--force` permite cargar un
 * archivo más viejo que la lista vigente. Ver docs/product-prices.md.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import { readPriceListFile } from './price-list.file';
import { ProductPricesService } from './product-prices.service';

async function main(): Promise<void> {
  const logger = new Logger('LoadPricesCli');
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
  });
  const [path] = positionals;
  if (!path) {
    throw new Error(
      'Uso: pnpm prices:load <archivo.json> [--dry-run] [--force]',
    );
  }

  // Se valida antes de levantar Nest: un archivo malo no abre conexiones.
  const file = readPriceListFile(resolve(path));
  logger.log(
    `Archivo válido: lista ${file.list}, ${file.items.length} SKUs, foto ${file.snapshotDate}`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const summary = await app.get(ProductPricesService).load(file, {
      dryRun: values['dry-run'],
      force: values.force,
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  new Logger('LoadPricesCli').error((error as Error).message);
  process.exitCode = 1;
});
