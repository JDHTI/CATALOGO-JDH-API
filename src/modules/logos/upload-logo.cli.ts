/**
 * Carga de un logo comercial al bucket y su referencia en el catálogo:
 *
 *   pnpm logos:upload -- --tipo=marca --nombre="CORONA" --archivo=./corona.png
 *   pnpm logos:upload -- --tipo=proveedor --nombre="ACO UNILEVER" --archivo=./aco.png
 *
 * El nombre debe ser el EXACTO del catálogo (no distingue mayúsculas): es el
 * que devuelven `GET /brands` y `GET /suppliers`. Formatos: png, jpg, webp, svg.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import { LogosService } from './logos.service';

function arg(nombre: string): string | undefined {
  const prefijo = `--${nombre}=`;
  return process.argv
    .find((valor) => valor.startsWith(prefijo))
    ?.slice(prefijo.length);
}

async function main(): Promise<void> {
  const logger = new Logger('UploadLogoCli');

  const tipo = arg('tipo');
  const nombre = arg('nombre');
  const archivo = arg('archivo');

  if (tipo !== 'marca' && tipo !== 'proveedor') {
    logger.error('--tipo debe ser "marca" o "proveedor"');
    process.exitCode = 1;
    return;
  }
  if (!nombre || !archivo) {
    logger.error(
      'Uso: pnpm logos:upload -- --tipo=marca --nombre="CORONA" --archivo=./corona.png',
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
      .get(LogosService)
      .upload(tipo, nombre, contenido, basename(archivo));

    logger.log(
      `${resultado.reemplazo ? 'Logo reemplazado' : 'Logo cargado'} para ${resultado.owner} ` +
        `"${resultado.nombre}" (id ${resultado.id}): ${resultado.url}`,
    );
  } catch (error) {
    logger.error(`Carga fallida: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
