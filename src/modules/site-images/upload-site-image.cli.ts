/**
 * Carga de una imagen general del sitio (hero, banners) al bucket,
 * convertida a WebP:
 *
 *   pnpm site-images:upload -- --categoria=hero --slug=home-desktop --archivo=./entradas/site/home-desktop.png
 *   pnpm site-images:upload -- --categoria=banners --slug=home-top-mobile --archivo=./entradas/site/banner1-mobile.jpg
 *
 * Un archivo a la vez. La key final es `site/<categoria>/<slug>.webp`;
 * volver a correrlo con la misma categoria+slug REEMPLAZA la imagen.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import {
  SITE_IMAGE_CATEGORIES,
  SiteImagesService,
  type SiteImageCategory,
} from './site-images.service';

function arg(nombre: string): string | undefined {
  const prefijo = `--${nombre}=`;
  return process.argv
    .find((valor) => valor.startsWith(prefijo))
    ?.slice(prefijo.length);
}

function isCategoria(valor: string | undefined): valor is SiteImageCategory {
  return SITE_IMAGE_CATEGORIES.includes(valor as SiteImageCategory);
}

/**
 * `error.message` puede venir vacío en errores de red de Node (p. ej.
 * `AggregateError` de una conexión fallida al endpoint S3/R2, que guarda el
 * detalle real en `.errors`), así que se arma un mensaje legible a mano en
 * vez de confiar solo en `.message`.
 */
function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    return error.errors.map((e) => describeError(e)).join(' | ');
  }
  if (error instanceof Error) {
    const name = error.name && error.name !== 'Error' ? `${error.name}: ` : '';
    return `${name}${error.message || '(sin mensaje, ver stack)\n' + error.stack}`;
  }
  return String(error);
}

async function main(): Promise<void> {
  const logger = new Logger('UploadSiteImageCli');

  const categoria = arg('categoria');
  const slug = arg('slug');
  const archivo = arg('archivo');

  if (!isCategoria(categoria)) {
    logger.error(
      `--categoria debe ser una de: ${SITE_IMAGE_CATEGORIES.join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }
  if (!slug || !archivo) {
    logger.error(
      'Uso: pnpm site-images:upload -- --categoria=hero --slug=home-desktop --archivo=./home-desktop.png',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const contenido = await readFile(archivo);
    const resultado = await app
      .get(SiteImagesService)
      .upload(categoria, slug, contenido, basename(archivo));

    logger.log(
      `${resultado.reemplazo ? 'Imagen reemplazada' : 'Imagen cargada'}: ${resultado.url}`,
    );
  } catch (error) {
    logger.error(`Carga fallida: ${describeError(error)}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
