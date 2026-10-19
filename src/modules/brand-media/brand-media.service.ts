import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '@infrastructure/database';
import { StorageService, type ListedObject } from '@infrastructure/storage';
import { SiteImageProcessorService } from '@modules/site-images/site-image-processor.service';

import {
  BRAND_MANIFEST_KEY,
  BRAND_MEDIA_PREFIX,
  brandLogoKey,
  buildBrandManifest,
  parseBrandLogoKey,
  type BrandManifest,
  type BrandManifestMarca,
} from './brand-media.layout';

export type BrandLogoOutcome =
  | { status: 'ok'; objectKey: string; reemplazados: string[] }
  | { status: 'omitido'; objectKey: string; motivo: string };

/**
 * Logos de marca bajo `brands/{slug}/` en el bucket, más un
 * `brands/manifest.json` público que el frontend lee directo del CDN, sin
 * pasar por la API. La marca es el nombre del archivo; la BD solo se lee
 * para enlazar cada logo con su `Brand`. Ver docs/brand-media.md.
 *
 * Sin controlador HTTP a propósito, igual que `logos/` y `site-images/`: el
 * disparo es `pnpm brands:ingest`, solo local.
 */
@Injectable()
export class BrandMediaService {
  private readonly logger = new Logger(BrandMediaService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly processor: SiteImageProcessorService,
    private readonly prisma: PrismaService,
  ) {}

  listBrandObjects(): Promise<ListedObject[]> {
    return this.storage.list(BRAND_MEDIA_PREFIX);
  }

  /**
   * Sube el logo de una marca. La key lleva el hash del contenido, así que si
   * ya existe la misma imagen se omite; si existía otra versión del logo de
   * esa marca, se borra después de subir la nueva.
   */
  async ingestLogo(params: {
    slug: string;
    buffer: Buffer;
    existing: ListedObject[];
    dryRun: boolean;
    force: boolean;
  }): Promise<BrandLogoOutcome> {
    const { slug, buffer, existing, dryRun, force } = params;

    const hash8 = createHash('sha256').update(buffer).digest('hex').slice(0, 8);
    const objectKey = brandLogoKey(slug, hash8);

    if (!force && existing.some((object) => object.key === objectKey)) {
      return { status: 'omitido', objectKey, motivo: 'checksum sin cambios' };
    }

    const reemplazados = existing
      .map((object) => object.key)
      .filter((key) => key !== objectKey && parseBrandLogoKey(key) === slug);

    // Se convierte también en dry-run: un archivo corrupto debe fallar en el
    // ensayo, no en la carga real.
    const webp = await this.processor.toWebp(buffer);
    if (dryRun) return { status: 'ok', objectKey, reemplazados };

    await this.storage.put(objectKey, webp, {
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    for (const key of reemplazados) await this.storage.delete(key);

    return { status: 'ok', objectKey, reemplazados };
  }

  /** Borra los logos de marcas que no vinieron en la entrega (`--prune`). */
  async prune(
    existing: ListedObject[],
    keep: Set<string>,
    dryRun: boolean,
  ): Promise<string[]> {
    const stale = existing
      .map((object) => object.key)
      .filter((key) => key !== BRAND_MANIFEST_KEY && !keep.has(key));
    if (!dryRun) {
      for (const key of stale) await this.storage.delete(key);
    }
    return stale;
  }

  /**
   * Regenera `brands/manifest.json` leyendo el bucket. En dry-run lo arma
   * pero no lo sube, aplicando encima los cambios que la corrida habría hecho
   * (`planned`), para que la vista previa refleje la carga real.
   */
  async publishManifest(
    dryRun: boolean,
    planned: { added: string[]; removed: string[] } = {
      added: [],
      removed: [],
    },
  ): Promise<{
    manifest: BrandManifest;
    url: string;
    catalog: Map<string, BrandManifestMarca>;
  }> {
    const removed = new Set(planned.removed);
    const now = new Date();
    const objects = [
      ...(await this.storage.list(BRAND_MEDIA_PREFIX)).filter(
        (object) => !removed.has(object.key),
      ),
      ...(dryRun
        ? planned.added.map((key) => ({ key, lastModified: now }))
        : []),
    ];

    const catalog = await this.loadCatalog();
    const manifest = buildBrandManifest(
      objects,
      (key) => this.storage.publicUrl(key),
      now,
      catalog,
    );

    const url = this.storage.publicUrl(BRAND_MANIFEST_KEY);
    if (!dryRun) {
      await this.storage.put(
        BRAND_MANIFEST_KEY,
        JSON.stringify(manifest, null, 2),
        {
          contentType: 'application/json; charset=utf-8',
          // Es la única key estable de la sección: corta para que un logo
          // nuevo aparezca en ~1 min sin purgar el CDN.
          cacheControl: 'public, max-age=60',
        },
      );
      this.logger.log(
        `Manifiesto publicado con ${manifest.marcas.length} marca(s): ${url}`,
      );
    }

    return { manifest, url, catalog };
  }

  /**
   * Marcas enlazables desde el manifiesto, por slug. Mismo criterio que
   * `GET /brands/:slug`: sin productos activos ese endpoint da 404, así que
   * el logo no se enlaza.
   */
  private async loadCatalog(): Promise<Map<string, BrandManifestMarca>> {
    const brands = await this.prisma.brand.findMany({
      where: { products: { some: { active: true } } },
      select: { id: true, slug: true, name: true },
    });
    return new Map(
      brands.map(({ id, slug, name }) => [slug, { id, slug, nombre: name }]),
    );
  }
}
