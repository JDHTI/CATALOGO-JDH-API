import { extname } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

import { StorageService } from '@infrastructure/storage';
import { LogosService } from '@modules/logos/logos.service';

import { SiteImageProcessorService } from './site-image-processor.service';

/** Categorías admitidas hoy. Cada una es un prefijo fijo del bucket. */
export const SITE_IMAGE_CATEGORIES = ['hero', 'banners'] as const;
export type SiteImageCategory = (typeof SITE_IMAGE_CATEGORIES)[number];

export const SITE_IMAGE_SOURCE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.tiff',
  '.avif',
]);

export interface SiteImageUploadResult {
  key: string;
  url: string;
  reemplazo: boolean;
}

/**
 * Carga de imágenes generales del sitio (hero, banners). A diferencia de
 * productos y logos, no hay modelo en BD: el frontend arma la URL por
 * convención (`S3_PUBLIC_URL` + key fija). Ver docs/site-images.md.
 *
 * Sin controlador HTTP a propósito, igual que `logos/`: el disparo es
 * `pnpm site-images:upload`, solo local.
 */
@Injectable()
export class SiteImagesService {
  private readonly logger = new Logger(SiteImagesService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly processor: SiteImageProcessorService,
  ) {}

  async upload(
    categoria: SiteImageCategory,
    slugCrudo: string,
    contenido: Buffer,
    sourceFilename: string,
  ): Promise<SiteImageUploadResult> {
    const extension = extname(sourceFilename).toLowerCase();
    if (!SITE_IMAGE_SOURCE_EXTENSIONS.has(extension)) {
      throw new Error(
        `Extensión no soportada: "${extension}". Admitidas: ${[...SITE_IMAGE_SOURCE_EXTENSIONS].join(', ')}`,
      );
    }

    const slug = LogosService.slug(slugCrudo);
    if (!slug) {
      throw new Error(`--slug inválido: "${slugCrudo}"`);
    }

    const objectKey = `site/${categoria}/${slug}.webp`;
    const reemplazo = await this.storage.exists(objectKey);

    const webpBuffer = await this.processor.toWebp(contenido);

    const stored = await this.storage.put(objectKey, webpBuffer, {
      contentType: 'image/webp',
      // Corto a propósito: a diferencia de productos, la key es estable
      // (no lleva hash del contenido), así que reemplazar el archivo debe
      // reflejarse rápido en vez de quedar servido desde caché por un año.
      cacheControl: 'public, max-age=300',
    });

    this.logger.log(
      `${reemplazo ? 'Imagen reemplazada' : 'Imagen cargada'} en ${stored.key}`,
    );

    return { key: stored.key, url: stored.url, reemplazo };
  }
}
