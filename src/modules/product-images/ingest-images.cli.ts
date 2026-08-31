/**
 * Ingesta por lote de imágenes de producto: procesa, convierte a WebP
 * (thumb/card/full) y sube al bucket. SOLO LOCAL — ver docs/product-images.md
 * para el contrato de entrega que deben seguir los proveedores.
 *
 *   pnpm images:ingest -- --dir=./entradas
 *   pnpm images:ingest -- --dir=./entradas/ACO-UNILEVER --proveedor=P0123
 *   pnpm images:ingest -- --dir=./entradas --dry-run --force --concurrencia=4
 *
 * `--dir` puede ser la carpeta raíz que contiene una subcarpeta por
 * proveedor, o (con `--proveedor`) la carpeta de un único proveedor.
 * Escribe `reports/images-ingest-{timestamp}.csv` con el resultado de
 * cada archivo procesado.
 */
import { cpus } from 'node:os';
import { basename, extname, join, relative, resolve } from 'node:path';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import { parseImageFilename } from './filename-parser';
import type { IngestOutcome, ResolvedSupplier } from './product-images.service';
import { ProductImagesService } from './product-images.service';

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.tiff',
  '.avif',
]);

interface DiscoveredFile {
  supplierFolder: string;
  relativePath: string;
  absolutePath: string;
}

interface ReportRow {
  archivo: string;
  carpeta: string;
  proveedor: string;
  sku: string;
  estado: 'ok' | 'omitido' | 'error';
  motivo: string;
  productIds: string;
  objectKeyBase: string;
}

const REPORT_COLUMNS: (keyof ReportRow)[] = [
  'archivo',
  'carpeta',
  'proveedor',
  'sku',
  'estado',
  'motivo',
  'productIds',
  'objectKeyBase',
];

function arg(nombre: string): string | undefined {
  const prefijo = `--${nombre}=`;
  return process.argv
    .find((valor) => valor.startsWith(prefijo))
    ?.slice(prefijo.length);
}

function flag(nombre: string): boolean {
  return process.argv.includes(`--${nombre}`);
}

/** Recorre recursivamente una carpeta de proveedor y lista sus imágenes. */
async function walkSupplierFolder(
  rootDir: string,
  supplierFolder: string,
): Promise<DiscoveredFile[]> {
  const results: DiscoveredFile[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        results.push({
          supplierFolder,
          relativePath: relative(rootDir, full),
          absolutePath: full,
        });
      }
    }
  }

  await walk(rootDir);
  return results;
}

/**
 * Descubre los archivos a procesar, agrupados por carpeta de proveedor.
 * Con `--proveedor` la raíz completa se trata como una única carpeta;
 * si no, cada subcarpeta de primer nivel es un proveedor distinto.
 */
async function discoverInputs(
  rootDir: string,
  proveedorOverride: string | undefined,
): Promise<Map<string, DiscoveredFile[]>> {
  if (proveedorOverride) {
    return new Map([
      [proveedorOverride, await walkSupplierFolder(rootDir, proveedorOverride)],
    ]);
  }

  const entries = await readdir(rootDir, { withFileTypes: true });
  const bySupplierFolder = new Map<string, DiscoveredFile[]>();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderPath = join(rootDir, entry.name);
    bySupplierFolder.set(
      entry.name,
      await walkSupplierFolder(folderPath, entry.name),
    );
  }

  return bySupplierFolder;
}

/** Ejecuta `worker` sobre `items` con un máximo de tareas en paralelo. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;

  async function next(): Promise<void> {
    const current = index++;
    if (current >= items.length) return;
    await worker(items[current]);
    await next();
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, next),
  );
}

function outcomeToRow(
  file: DiscoveredFile,
  supplierCode: string,
  outcome: IngestOutcome,
): ReportRow {
  const base = {
    archivo: file.relativePath,
    carpeta: file.supplierFolder,
    proveedor: supplierCode,
  };

  if (outcome.status === 'error') {
    return {
      ...base,
      sku: '',
      estado: 'error',
      motivo: outcome.motivo,
      productIds: '',
      objectKeyBase: '',
    };
  }
  if (outcome.status === 'omitido') {
    return {
      ...base,
      sku: outcome.sku,
      estado: 'omitido',
      motivo: outcome.motivo,
      productIds: outcome.productIds.join('|'),
      objectKeyBase: '',
    };
  }
  return {
    ...base,
    sku: outcome.sku,
    estado: 'ok',
    motivo: '',
    productIds: outcome.productIds.join('|'),
    objectKeyBase: outcome.objectKeyBase,
  };
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function writeCsvReport(rows: ReportRow[]): Promise<string> {
  const reportsDir = resolve('reports');
  await mkdir(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = join(reportsDir, `images-ingest-${timestamp}.csv`);

  const lines = [
    REPORT_COLUMNS.join(','),
    ...rows.map((row) =>
      REPORT_COLUMNS.map((column) => csvEscape(row[column])).join(','),
    ),
  ];

  await writeFile(reportPath, lines.join('\n'), 'utf-8');
  return reportPath;
}

async function processSupplierFolder(
  service: ProductImagesService,
  folderName: string,
  files: DiscoveredFile[],
  options: { dryRun: boolean; force: boolean; concurrencia: number },
  rows: ReportRow[],
  logger: Logger,
): Promise<void> {
  if (files.length === 0) return;

  const supplier = await service.resolveSupplier(folderName);
  if (!supplier) {
    logger.warn(
      `Proveedor no encontrado para la carpeta "${folderName}" (${files.length} archivo(s) omitidos)`,
    );
    for (const file of files) {
      rows.push({
        archivo: file.relativePath,
        carpeta: folderName,
        proveedor: '',
        sku: '',
        estado: 'error',
        motivo: `Proveedor no encontrado para la carpeta "${folderName}"`,
        productIds: '',
        objectKeyBase: '',
      });
    }
    return;
  }

  await runWithConcurrency(files, options.concurrencia, async (file) => {
    rows.push(
      await processFile(service, supplier, file, options.dryRun, options.force),
    );
  });
}

async function processFile(
  service: ProductImagesService,
  supplier: ResolvedSupplier,
  file: DiscoveredFile,
  dryRun: boolean,
  force: boolean,
): Promise<ReportRow> {
  const base = {
    archivo: file.relativePath,
    carpeta: file.supplierFolder,
    proveedor: supplier.code,
  };

  try {
    const buffer = await readFile(file.absolutePath);
    const sourceFilename = basename(file.absolutePath);
    const candidates = parseImageFilename(sourceFilename);

    if (candidates.length === 0) {
      return {
        ...base,
        sku: '',
        estado: 'error',
        motivo: 'No se pudo derivar un SKU del nombre de archivo',
        productIds: '',
        objectKeyBase: '',
      };
    }

    const outcome = await service.ingestFile({
      supplier,
      candidates,
      buffer,
      sourceFilename,
      dryRun,
      force,
    });

    return outcomeToRow(file, supplier.code, outcome);
  } catch (error) {
    return {
      ...base,
      sku: '',
      estado: 'error',
      motivo: (error as Error).message,
      productIds: '',
      objectKeyBase: '',
    };
  }
}

function printSummary(
  rows: ReportRow[],
  reportPath: string,
  logger: Logger,
): void {
  const counts = { ok: 0, omitido: 0, error: 0 };
  for (const row of rows) counts[row.estado]++;

  logger.log(
    `Total: ${rows.length} · ok: ${counts.ok} · omitidos: ${counts.omitido} · errores: ${counts.error}`,
  );
  logger.log(`Reporte: ${reportPath}`);

  if (counts.error > 0) {
    logger.warn(`Hay ${counts.error} archivo(s) con error. Revisa el CSV.`);
  }
}

async function main(): Promise<void> {
  const logger = new Logger('IngestImagesCli');

  const dir = arg('dir');
  if (!dir) {
    logger.error(
      'Uso: pnpm images:ingest -- --dir=./entradas [--proveedor=CODIGO] [--dry-run] [--force] [--concurrencia=4]',
    );
    process.exitCode = 1;
    return;
  }

  const rootDir = resolve(dir);
  const proveedorOverride = arg('proveedor');
  const dryRun = flag('dry-run');
  const force = flag('force');
  const concurrenciaArg = arg('concurrencia');
  const concurrencia = concurrenciaArg
    ? Number(concurrenciaArg)
    : Math.min(4, cpus().length);

  if (dryRun) logger.log('Modo --dry-run: no se sube ni se escribe en BD');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  const rows: ReportRow[] = [];

  try {
    const service = app.get(ProductImagesService);
    const bySupplierFolder = await discoverInputs(rootDir, proveedorOverride);

    for (const [folderName, files] of bySupplierFolder) {
      await processSupplierFolder(
        service,
        folderName,
        files,
        { dryRun, force, concurrencia },
        rows,
        logger,
      );
    }
  } finally {
    await app.close();
  }

  if (rows.length === 0) {
    logger.warn(`No se encontraron imágenes bajo "${rootDir}"`);
    return;
  }

  const reportPath = await writeCsvReport(rows);
  printSummary(rows, reportPath, logger);
}

void main();
