import { basename, dirname, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import {
  ProductContentService,
  type ProductContentImportSummary,
} from './product-content.service';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function run(): Promise<void> {
  const logger = new Logger('ProductContentCli');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const service = app.get(ProductContentService);
    if (flag('inventory')) {
      const output = resolve(
        arg('output') ??
          `reports/product-content-inventory-${timestamp()}.json`,
      );
      const inventory = await service.inventory(!flag('include-inactive'));
      await mkdir(dirname(output), { recursive: true });
      await writeFile(
        output,
        JSON.stringify(
          {
            formatVersion: 1,
            generatedAt: new Date().toISOString(),
            products: inventory,
          },
          null,
          2,
        ),
        'utf8',
      );
      logger.log(
        `Inventario escrito: ${output} (${inventory.length} productos)`,
      );
      return;
    }

    const inputPath = arg('file');
    if (!inputPath) {
      throw new Error(
        'Uso: pnpm product-content:import -- --file=content.json [--apply] [--replace] o --inventory [--output=archivo.json]',
      );
    }
    if (flag('replace') && !flag('apply')) {
      throw new Error(
        '--replace requiere --apply para evitar cambios accidentales',
      );
    }
    const parsed = JSON.parse(
      await readFile(resolve(inputPath), 'utf8'),
    ) as unknown;
    const summary = await service.import(parsed, {
      apply: flag('apply'),
      replace: flag('replace'),
    });
    printSummary(summary, basename(inputPath), logger);
    if (summary.errors.length > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

function printSummary(
  summary: ProductContentImportSummary,
  file: string,
  logger: Logger,
): void {
  logger.log(
    `${summary.mode}: ${file} · ${summary.total} registros · ` +
      `${summary.valid} válidos · ${summary.applied} aplicados · ` +
      `${summary.unchanged} sin cambios · ${summary.preserved} valores conservados · ` +
      `${summary.pending} pendientes · ${summary.errors.length} errores`,
  );
  for (const error of summary.errors) logger.error(error);
}

void run().catch((error: unknown) => {
  const logger = new Logger('ProductContentCli');
  logger.error((error as Error).message);
  process.exitCode = 1;
});
