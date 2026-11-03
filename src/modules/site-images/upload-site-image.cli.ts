/**
 * Carga de imágenes generales del sitio (hero, banners) al bucket,
 * convertidas a WebP.
 *
 * Un archivo:
 *   pnpm site-images:upload -- --categoria=hero --slug=home-desktop --archivo=./entradas/site/home-desktop.png
 *   pnpm site-images:upload -- --categoria=banners --slug=home-top-mobile --archivo=./entradas/site/banner1-mobile.jpg
 *
 * Una carpeta completa (sube cada imagen que encuentre adentro; el slug de
 * cada una sale de su propio nombre de archivo):
 *   pnpm site-images:upload -- --categoria=banners --dir=./entradas/site/banners
 *
 * La key final es `site/<categoria>/<slug>.webp`; volver a correrlo con la
 * misma categoria+slug (o el mismo nombre de archivo, en modo --dir)
 * REEMPLAZA la imagen.
 */
import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { LogosService } from '../logos/logos.service';
import { AppModule } from '../../app.module';
import {
  SITE_IMAGE_CATEGORIES,
  SITE_IMAGE_SOURCE_EXTENSIONS,
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

async function listImageFiles(dir: string): Promise<string[]> {
  const entradas = await readdir(dir, { withFileTypes: true });
  return entradas
    .filter(
      (entrada) =>
        entrada.isFile() &&
        SITE_IMAGE_SOURCE_EXTENSIONS.has(extname(entrada.name).toLowerCase()),
    )
    .map((entrada) => join(dir, entrada.name))
    .sort();
}

async function main(): Promise<void> {
  const logger = new Logger('UploadSiteImageCli');

  const categoria = arg('categoria');
  const slug = arg('slug');
  const archivo = arg('archivo');
  const dir = arg('dir');

  if (!isCategoria(categoria)) {
    logger.error(
      `--categoria debe ser una de: ${SITE_IMAGE_CATEGORIES.join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }
  if (!dir && (!slug || !archivo)) {
    logger.error(
      'Uso: pnpm site-images:upload -- --categoria=hero --slug=home-desktop --archivo=./home-desktop.png\n' +
        '  o: pnpm site-images:upload -- --categoria=banners --dir=./entradas/site/banners',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const service = app.get(SiteImagesService);

    if (dir) {
      const archivos = await listImageFiles(dir);
      if (archivos.length === 0) {
        logger.warn(`No se encontraron imágenes en "${dir}"`);
        return;
      }

      let cargadas = 0;
      let reemplazadas = 0;
      let fallidas = 0;

      for (const ruta of archivos) {
        const nombre = basename(ruta);
        const slugArchivo = LogosService.slug(
          nombre.slice(0, nombre.length - extname(nombre).length),
        );
        try {
          const contenido = await readFile(ruta);
          const resultado = await service.upload(
            categoria,
            slugArchivo,
            contenido,
            nombre,
          );
          resultado.reemplazo ? reemplazadas++ : cargadas++;
          logger.log(
            `${resultado.reemplazo ? 'Reemplazada' : 'Cargada'}: ${nombre} -> ${resultado.url}`,
          );
        } catch (error) {
          fallidas++;
          logger.error(`Carga fallida (${nombre}): ${describeError(error)}`);
        }
      }

      logger.log(
        `Listo: ${cargadas} nuevas, ${reemplazadas} reemplazadas, ${fallidas} fallidas de ${archivos.length} archivo(s).`,
      );
      if (fallidas > 0) {
        process.exitCode = 1;
      }
      return;
    }

    const contenido = await readFile(archivo!);
    const resultado = await service.upload(
      categoria,
      slug!,
      contenido,
      basename(archivo!),
    );

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
