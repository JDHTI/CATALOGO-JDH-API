import { extname } from 'node:path';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { CacheService } from '@infrastructure/cache';
import { PrismaService } from '@infrastructure/database';
import { StorageService } from '@infrastructure/storage';

/** A qué entidad pertenece el logo. */
export type LogoOwner = 'marca' | 'proveedor';

export interface LogoUploadResult {
  owner: LogoOwner;
  id: number;
  nombre: string;
  objectKey: string;
  url: string;
  reemplazo: boolean;
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/**
 * Carga de logos comerciales de marcas y proveedores.
 *
 * Los logos son un dato EDITORIAL: no vienen del DWH y el sync de productos
 * nunca los toca. Se cargan aparte con `pnpm logos:upload`.
 *
 * No hay endpoint HTTP de subida a propósito: el catálogo es público y todavía
 * no tiene capa de autenticación.
 */
@Injectable()
export class LogosService {
  private readonly logger = new Logger(LogosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Slug estable para la key del objeto: sin acentos, sin símbolos y en
   * minúsculas. Solo afecta al nombre del archivo en el bucket, nunca al
   * nombre que se muestra (ese se conserva crudo tal como llega del DWH).
   */
  static slug(nombre: string): string {
    return nombre
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Sube el logo al bucket y deja la referencia en la fila correspondiente.
   * Busca por nombre exacto (sin distinguir mayúsculas) porque es como los
   * identifica quien prepara los archivos.
   */
  async upload(
    owner: LogoOwner,
    nombre: string,
    contenido: Buffer,
    nombreArchivo: string,
  ): Promise<LogoUploadResult> {
    const extension = extname(nombreArchivo).toLowerCase();
    const contentType = CONTENT_TYPES[extension];
    if (!contentType) {
      throw new Error(
        `Extensión no soportada: "${extension}". Admitidas: ${Object.keys(CONTENT_TYPES).join(', ')}`,
      );
    }

    const entidad = await this.findByName(owner, nombre);
    const objectKey = `logos/${owner === 'marca' ? 'marcas' : 'proveedores'}/${LogosService.slug(entidad.name)}${extension}`;

    const stored = await this.storage.put(objectKey, contenido, {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    });

    await this.saveReference(owner, entidad.id, stored.key, stored.url);
    // Sin esto, los listados siguen sirviendo el logoUrl anterior hasta 5 min.
    await this.cache.invalidateByPrefix('http:');

    this.logger.log(
      `Logo de ${owner} "${entidad.name}" cargado en ${stored.key}`,
    );

    return {
      owner,
      id: entidad.id,
      nombre: entidad.name,
      objectKey: stored.key,
      url: stored.url,
      reemplazo: entidad.logoUrl !== null,
    };
  }

  private async findByName(
    owner: LogoOwner,
    nombre: string,
  ): Promise<{ id: number; name: string; logoUrl: string | null }> {
    const where = { name: { equals: nombre, mode: 'insensitive' as const } };

    const entidad =
      owner === 'marca'
        ? await this.prisma.brand.findFirst({
            where,
            select: { id: true, name: true, logoUrl: true },
          })
        : await this.prisma.supplier.findFirst({
            where,
            select: { id: true, name: true, logoUrl: true },
          });

    if (!entidad) {
      throw new NotFoundException(
        `No existe ${owner === 'marca' ? 'la marca' : 'el proveedor'} "${nombre}". Usa el nombre exacto del catálogo.`,
      );
    }
    return entidad;
  }

  private async saveReference(
    owner: LogoOwner,
    id: number,
    objectKey: string,
    url: string,
  ): Promise<void> {
    const data = { logoObjectKey: objectKey, logoUrl: url };

    if (owner === 'marca') {
      await this.prisma.brand.update({ where: { id }, data });
      return;
    }
    await this.prisma.supplier.update({ where: { id }, data });
  }
}
