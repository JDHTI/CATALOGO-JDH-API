/**
 * Ingesta por lote de logos de marca a `brands/` en el bucket y regeneración
 * de `brands/manifest.json`. SOLO LOCAL — ver docs/brand-media.md.
 *
 *   pnpm brands:ingest -- --dir=./Logos --dry-run
 *   pnpm brands:ingest -- --dir=./Logos
 *   pnpm brands:ingest -- --dir=./Logos --prune
 *   pnpm brands:ingest -- --solo-manifiesto
 *
 * `--dir` es una carpeta plana: cada imagen es el logo de una marca y el
 * nombre del archivo es la marca (`alpina.png` → `alpina`). Escribe
 * `reports/brands-ingest-{timestamp}.csv` y, en `--dry-run`, la vista previa
 * del manifiesto junto al CSV.
 */
import { join, resolve } from 'node:path';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import {
  brandSlugFromFilename,
  isLogoFile,
  suggestCatalogSlug,
} from './brand-media.layout';
import { BrandMediaService } from './brand-media.service';

interface ReportRow {
  archivo: string;
  marca: string;
  estado: 'ok' | 'omitido' | 'error' | 'eliminado' | 'sin-marca';
  motivo: string;
  objectKey: string;
}

const REPORT_COLUMNS: (keyof ReportRow)[] = [
  'archivo',
  'marca',
  'estado',
  'motivo',
  'objectKey',
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

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function writeReports(
  rows: ReportRow[],
  manifestPreview: unknown,
): Promise<string> {
  const reportsDir = resolve('reports');
  await mkdir(reportsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const reportPath = join(reportsDir, `brands-ingest-${timestamp}.csv`);
  const lines = [
    REPORT_COLUMNS.join(','),
    ...rows.map((row) =>
      REPORT_COLUMNS.map((column) => csvEscape(row[column])).join(','),
    ),
  ];
  await writeFile(reportPath, lines.join('\n'), 'utf-8');

  if (manifestPreview) {
    await writeFile(
      join(reportsDir, `brands-manifest-${timestamp}.json`),
      JSON.stringify(manifestPreview, null, 2),
      'utf-8',
    );
  }
  return reportPath;
}

async function ingestFolder(
  service: BrandMediaService,
  rootDir: string,
  options: { dryRun: boolean; force: boolean; prune: boolean },
  rows: ReportRow[],
  planned: { added: string[]; removed: string[] },
): Promise<void> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const existing = await service.listBrandObjects();
  const delivered = new Set<string>();
  const seen = new Map<string, string>();

  for (const entry of entries) {
    // Carpetas y archivos que no son imagen (el CSV de cruce, p. ej.) no
    // son logos: se ignoran sin ensuciar el reporte.
    if (!entry.isFile() || !isLogoFile(entry.name)) continue;

    const marca = brandSlugFromFilename(entry.name);
    const base = { archivo: entry.name, marca };
    if (!marca) {
      rows.push({
        ...base,
        estado: 'error',
        motivo: 'Nombre de archivo inválido',
        objectKey: '',
      });
      continue;
    }
    const previous = seen.get(marca);
    if (previous) {
      rows.push({
        ...base,
        estado: 'error',
        motivo: `Misma marca que ${previous}; renombra uno de los dos`,
        objectKey: '',
      });
      continue;
    }
    seen.set(marca, entry.name);

    try {
      const outcome = await service.ingestLogo({
        slug: marca,
        buffer: await readFile(join(rootDir, entry.name)),
        existing,
        dryRun: options.dryRun,
        force: options.force,
      });
      delivered.add(outcome.objectKey);
      if (outcome.status === 'ok') {
        planned.added.push(outcome.objectKey);
        planned.removed.push(...outcome.reemplazados);
      }
      rows.push({
        ...base,
        estado: outcome.status,
        motivo:
          outcome.status === 'omitido'
            ? outcome.motivo
            : outcome.reemplazados.length > 0
              ? `reemplaza ${outcome.reemplazados.join(' | ')}`
              : '',
        objectKey: outcome.objectKey,
      });
    } catch (error) {
      rows.push({
        ...base,
        estado: 'error',
        motivo: (error as Error).message,
        objectKey: '',
      });
    }
  }

  if (options.prune) {
    // Lo ya reemplazado en esta corrida no se vuelve a contar como eliminado.
    const alreadyRemoved = new Set(planned.removed);
    const stale = await service.prune(
      existing.filter((object) => !alreadyRemoved.has(object.key)),
      delivered,
      options.dryRun,
    );
    planned.removed.push(...stale);
    for (const key of stale) {
      rows.push({
        archivo: '',
        marca: '',
        estado: 'eliminado',
        motivo: '--prune: no está en la carpeta',
        objectKey: key,
      });
    }
  }
}

async function main(): Promise<void> {
  const logger = new Logger('IngestBrandMediaCli');

  const dir = arg('dir');
  const soloManifiesto = flag('solo-manifiesto');
  if (!dir && !soloManifiesto) {
    logger.error(
      'Uso: pnpm brands:ingest -- --dir=./Logos [--dry-run] [--force] [--prune] | --solo-manifiesto',
    );
    process.exitCode = 1;
    return;
  }

  const dryRun = flag('dry-run');
  const options = { dryRun, force: flag('force'), prune: flag('prune') };
  if (dryRun) logger.log('Modo --dry-run: no se sube ni se borra nada');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  const rows: ReportRow[] = [];
  const planned = { added: [] as string[], removed: [] as string[] };
  let manifestPreview: unknown;

  try {
    const service = app.get(BrandMediaService);
    if (dir) await ingestFolder(service, resolve(dir), options, rows, planned);

    const { manifest, url, catalog } = await service.publishManifest(
      dryRun,
      planned,
    );
    if (dryRun) manifestPreview = manifest;

    // Todo el bucket, no solo esta entrega: es la lista de logos que la UI
    // no puede enlazar hasta que operaciones renombre el archivo.
    for (const entry of manifest.marcas) {
      if (entry.marca) continue;
      const sugerencia = suggestCatalogSlug(entry.slug, catalog.keys());
      rows.push({
        archivo: '',
        marca: entry.slug,
        estado: 'sin-marca',
        motivo: sugerencia
          ? `sin marca en catálogo; renombra el archivo a ${sugerencia}`
          : 'sin marca en catálogo',
        objectKey: '',
      });
    }
    logger.log(
      `${dryRun ? 'Manifiesto (vista previa)' : 'Manifiesto'}: ${manifest.marcas.length} marca(s) · ${url}`,
    );
  } finally {
    await app.close();
  }

  if (!soloManifiesto && rows.every((row) => row.estado === 'sin-marca')) {
    logger.warn(`No se encontraron logos en "${resolve(dir!)}"`);
  }

  const reportPath = await writeReports(rows, manifestPreview);
  const counts = { ok: 0, omitido: 0, error: 0, eliminado: 0, 'sin-marca': 0 };
  for (const row of rows) counts[row.estado]++;
  logger.log(
    `Total: ${rows.length} · ok: ${counts.ok} · omitidos: ${counts.omitido} · errores: ${counts.error} · eliminados: ${counts.eliminado} · sin marca: ${counts['sin-marca']}`,
  );
  if (counts['sin-marca'] > 0) {
    logger.warn(
      `${counts['sin-marca']} logo(s) sin marca en el catálogo: la UI no los enlaza. Revisa el CSV.`,
    );
  }
  logger.log(`Reporte: ${reportPath}`);
  if (counts.error > 0) {
    logger.warn(`Hay ${counts.error} archivo(s) con error. Revisa el CSV.`);
    process.exitCode = 1;
  }
}

void main();
