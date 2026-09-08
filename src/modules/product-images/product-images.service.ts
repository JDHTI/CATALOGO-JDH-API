import { createHash } from 'node:crypto';
import { extname } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

import { CacheService } from '@infrastructure/cache';
import { PrismaService } from '@infrastructure/database';
import { StorageService } from '@infrastructure/storage';
import { LogosService } from '@modules/logos/logos.service';

import type { ParsedFilenameCandidate } from './filename-parser';
import { ImageProcessorService } from './image-processor.service';

export interface ResolvedSupplier {
  id: number;
  code: string;
  name: string;
}

export interface IngestFileParams {
  supplier: ResolvedSupplier;
  /** Candidatos de SKU en orden de prioridad (ver filename-parser). */
  candidates: ParsedFilenameCandidate[];
  buffer: Buffer;
  sourceFilename: string;
  dryRun: boolean;
  force: boolean;
}

export type IngestOutcome =
  | {
      status: 'ok';
      sku: string;
      productIds: number[];
      objectKeyBase: string;
    }
  | {
      status: 'omitido';
      sku: string;
      productIds: number[];
      motivo: string;
    }
  | {
      status: 'error';
      motivo: string;
    };

const CACHE_INVALIDATION_PREFIX = 'http:';

/**
 * Ingesta de imágenes de producto: resuelve proveedor y SKU, procesa con
 * `ImageProcessorService`, sube al bucket y deja la referencia en
 * `product_images`. Sin controlador HTTP a propósito, igual que `logos/`:
 * el disparo es `pnpm images:ingest`, solo local (ver docs/product-images.md).
 */
@Injectable()
export class ProductImagesService {
  private readonly logger = new Logger(ProductImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cache: CacheService,
    private readonly processor: ImageProcessorService,
  ) {}

  /**
   * Resuelve el proveedor a partir del nombre de una carpeta de entrada.
   * Orden: código exacto del ERP → nombre exacto (sin distinguir mayúsculas)
   * → slug (mismo criterio que los logos, para tolerar variaciones menores
   * de puntuación/acentos en el nombre de la carpeta).
   */
  async resolveSupplier(folderName: string): Promise<ResolvedSupplier | null> {
    const trimmed = folderName.trim();
    if (!trimmed) return null;

    const byCode = await this.prisma.supplier.findUnique({
      where: { code: trimmed },
      select: { id: true, code: true, name: true },
    });
    if (byCode) return byCode;

    const byName = await this.prisma.supplier.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' } },
      select: { id: true, code: true, name: true },
    });
    if (byName) return byName;

    const targetSlug = LogosService.slug(trimmed);
    if (!targetSlug) return null;

    const suppliers = await this.prisma.supplier.findMany({
      select: { id: true, code: true, name: true },
    });
    return (
      suppliers.find(
        (supplier) => LogosService.slug(supplier.name) === targetSlug,
      ) ?? null
    );
  }

  /**
   * Procesa y sube un archivo ya identificado con su proveedor y candidatos
   * de SKU. Prueba los candidatos EN ORDEN contra la base de datos; el
   * primero con al menos un producto (proveedor + sku) gana.
   */
  async ingestFile(params: IngestFileParams): Promise<IngestOutcome> {
    const match = await this.matchProducts(
      params.supplier.id,
      params.candidates,
    );
    if (!match) {
      const skusIntentados = params.candidates.map((c) => c.sku).join(' | ');
      return {
        status: 'error',
        motivo: `Sin producto para "${skusIntentados}" en el proveedor "${params.supplier.name}"`,
      };
    }

    const { candidate, productIds } = match;
    const checksum = createHash('sha256').update(params.buffer).digest('hex');

    if (!params.force) {
      const unchanged = await this.allUnchanged(
        productIds,
        candidate.position,
        checksum,
      );
      if (unchanged) {
        return {
          status: 'omitido',
          sku: candidate.sku,
          productIds,
          motivo: 'checksum sin cambios',
        };
      }
    }

    // Carpeta del producto en el bucket. El layout por carpeta la trae como
    // `{referencia}-{nombre}`; el layout plano cae al propio SKU.
    const objectFolder = candidate.objectFolder ?? candidate.sku;
    const objectKeyBase = `products/${params.supplier.code}/${objectFolder}/${checksum.slice(0, 8)}`;

    if (params.dryRun) {
      return { status: 'ok', sku: candidate.sku, productIds, objectKeyBase };
    }

    const processed = await this.processor.process(params.buffer);

    const originalExtension =
      extname(params.sourceFilename).toLowerCase() || '.bin';
    const originalObjectKey = `originals/products/${params.supplier.code}/${objectFolder}/${checksum.slice(0, 8)}${originalExtension}`;

    await this.storage.put(originalObjectKey, params.buffer, {
      cacheControl: 'public, max-age=31536000, immutable',
    });

    const variantUrls = new Map<string, string>();
    for (const variant of processed.variants) {
      const stored = await this.storage.put(
        `${objectKeyBase}/${variant.name}.webp`,
        variant.buffer,
        {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
        },
      );
      variantUrls.set(variant.name, stored.url);
    }

    const thumbUrl = variantUrls.get('thumb')!;
    const cardUrl = variantUrls.get('card')!;
    const fullUrl = variantUrls.get('full')!;

    for (const productId of productIds) {
      await this.prisma.productImage.upsert({
        where: {
          productId_position: { productId, position: candidate.position },
        },
        create: {
          productId,
          objectKey: objectKeyBase,
          originalObjectKey,
          url: cardUrl,
          thumbUrl,
          cardUrl,
          fullUrl,
          sourceChecksum: checksum,
          sourceFilename: params.sourceFilename,
          width: processed.originalWidth,
          height: processed.originalHeight,
          bytes: params.buffer.byteLength,
          position: candidate.position,
          isPrimary: candidate.isPrimary,
        },
        update: {
          objectKey: objectKeyBase,
          originalObjectKey,
          url: cardUrl,
          thumbUrl,
          cardUrl,
          fullUrl,
          sourceChecksum: checksum,
          sourceFilename: params.sourceFilename,
          width: processed.originalWidth,
          height: processed.originalHeight,
          bytes: params.buffer.byteLength,
          isPrimary: candidate.isPrimary,
        },
      });
    }

    await this.cache.invalidateByPrefix(CACHE_INVALIDATION_PREFIX);

    this.logger.log(
      `Imagen de "${candidate.sku}" (proveedor ${params.supplier.code}) subida en ${objectKeyBase} → ${productIds.length} producto(s)`,
    );

    return { status: 'ok', sku: candidate.sku, productIds, objectKeyBase };
  }

  private async matchProducts(
    supplierId: number,
    candidates: ParsedFilenameCandidate[],
  ): Promise<{
    candidate: ParsedFilenameCandidate;
    productIds: number[];
  } | null> {
    for (const candidate of candidates) {
      const products = await this.prisma.product.findMany({
        where: { supplierId, sku: candidate.sku },
        select: { id: true },
      });
      if (products.length > 0) {
        return { candidate, productIds: products.map((p) => p.id) };
      }
    }
    return null;
  }

  private async allUnchanged(
    productIds: number[],
    position: number,
    checksum: string,
  ): Promise<boolean> {
    const existing = await this.prisma.productImage.findMany({
      where: { productId: { in: productIds }, position },
      select: { productId: true, sourceChecksum: true },
    });
    if (existing.length !== productIds.length) return false;

    return productIds.every(
      (productId) =>
        existing.find((row) => row.productId === productId)?.sourceChecksum ===
        checksum,
    );
  }
}
