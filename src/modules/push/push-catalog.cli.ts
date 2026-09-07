/**
 * Publica el catálogo local en la instancia desplegada (Railway):
 *
 *   pnpm push:catalogo
 *   pnpm push:catalogo -- --limit=50          # prueba de humo
 *   pnpm push:catalogo -- --skip-images       # solo datos, sin imágenes
 *
 * El DWH solo es alcanzable desde la red interna, así que la cadena completa
 * es: `pnpm sync:products` (DWH → local) y luego este comando (local → nube).
 *
 * Requiere `PUSH_TARGET_DATABASE_URL` en el `.env` local, con la cadena de
 * conexión PÚBLICA de la base de Railway. Ver docs/catalog-push.md.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { CatalogPushModule } from './catalog-push.module';
import {
  CatalogPushService,
  type CatalogPushSummary,
  type EntityCounters,
} from './catalog-push.service';

function arg(nombre: string): string | undefined {
  const prefijo = `--${nombre}=`;
  return process.argv
    .find((valor) => valor.startsWith(prefijo))
    ?.slice(prefijo.length);
}

function flag(nombre: string): boolean {
  return process.argv.includes(`--${nombre}`);
}

function linea(etiqueta: string, counters: EntityCounters): string {
  return (
    `  ${etiqueta.padEnd(14)} ${String(counters.read).padStart(6)} leídos  ` +
    `${String(counters.inserted).padStart(6)} nuevos  ` +
    `${String(counters.updated).padStart(6)} actualizados  ` +
    `${String(counters.unchanged).padStart(6)} sin cambios`
  );
}

function reporte(summary: CatalogPushSummary): string {
  return [
    `Publicación #${summary.runId} OK en ${Math.round(summary.durationMs / 1000)}s`,
    linea('proveedores', summary.suppliers),
    linea('marcas', summary.brands),
    linea('fabricantes', summary.manufacturers),
    linea('categorías', summary.categories),
    linea('subcategorías', summary.subcategories),
    linea('productos', summary.products),
    linea('imágenes', summary.images),
    `  productos desactivados en destino: ${summary.productsDeactivated}`,
    `  imágenes eliminadas en destino:    ${summary.imagesRemoved}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const logger = new Logger('PushCatalogoCli');

  const limitRaw = arg('limit');
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    logger.error('--limit debe ser un entero mayor que 0');
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(CatalogPushModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const summary = await app.get(CatalogPushService).run({
      limit,
      skipImages: flag('skip-images'),
    });
    logger.log(`\n${reporte(summary)}`);
    logger.warn(
      'La API desplegada cachea sus respuestas en Redis: los cambios pueden ' +
        'tardar hasta REDIS_DEFAULT_TTL (300s por defecto) en verse.',
    );
  } catch (error) {
    logger.error(`Publicación fallida: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
