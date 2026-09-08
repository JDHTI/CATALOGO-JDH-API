import { createHash } from 'node:crypto';

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DATABASE_CONFIG,
  PUSH_CONFIG,
  type DatabaseConfig,
  type PushConfig,
} from '@infrastructure/config';
import { PrismaService } from '@infrastructure/database';
import type { PrismaClient, Product, ProductImage } from '@prisma-client';

import {
  assertDistinctDatabases,
  createRemoteCatalogClient,
} from './remote-catalog.client';

/** Contadores de una entidad dentro de una publicación. */
export interface EntityCounters {
  read: number;
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface CatalogPushSummary {
  /** Id del `SyncRun` creado en la base DESTINO. */
  runId: number;
  suppliers: EntityCounters;
  brands: EntityCounters;
  manufacturers: EntityCounters;
  categories: EntityCounters;
  subcategories: EntityCounters;
  products: EntityCounters;
  images: EntityCounters;
  /** Productos que ya no existen en local y quedaron `active=false` allá. */
  productsDeactivated: number;
  /** Imágenes borradas en destino porque ya no existen en local. */
  imagesRemoved: number;
  durationMs: number;
}

export interface CatalogPushOptions {
  /** Publica solo los primeros N productos (prueba de humo). */
  limit?: number;
  /** Omite por completo la fase de imágenes. */
  skipImages?: boolean;
}

const emptyCounters = (): EntityCounters => ({
  read: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
});

/** Forma mínima de un `Prisma.Decimal` (decimal.js) para el hash. */
interface DecimalLike {
  toFixed(digits?: number): string;
  toString(): string;
}

function isDecimalLike(value: object): value is DecimalLike {
  return typeof (value as Partial<DecimalLike>).toFixed === 'function';
}

/** Normaliza un valor para que el hash sea estable entre corridas. */
function stable(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  // Prisma Decimal: se compara como texto, nunca como float.
  if (typeof value === 'object' && isDecimalLike(value)) {
    return value.toString();
  }
  return value;
}

function hashOf(values: readonly unknown[]): string {
  return createHash('sha1')
    .update(JSON.stringify(values.map(stable)))
    .digest('hex');
}

/**
 * Campos de producto que viajan a destino.
 *
 * Se derivan del modelo Prisma en vez de escribirse a mano: si mañana el
 * esquema gana una columna, esto deja de compilar hasta que se decida si
 * viaja o no. Fuera quedan el `id` (autoincremental, distinto en cada base),
 * las marcas de auditoría y `sourceHash`/`syncedAt`, que los pone el push.
 */
type RemoteProductData = Omit<
  Product,
  'id' | 'sourceHash' | 'syncedAt' | 'createdAt' | 'updatedAt'
>;

/** Campos de imagen que viajan a destino (mismo criterio que arriba). */
type RemoteImageData = Omit<ProductImage, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Publicación del catálogo local hacia otra instancia (Railway).
 *
 * ## Por qué existe
 *
 * El DWH solo es alcanzable desde la red interna de JDH, así que la API en la
 * nube no puede sincronizarse sola (`/health` la reporta con
 * `"datawarehouse":"disabled"`). La cadena real es:
 *
 *   DWH ──`pnpm sync:products`──► catálogo local ──`pnpm push:catalogo`──► Railway
 *
 * ## Qué viaja y qué no
 *
 * Viajan las FILAS de proveedores, marcas, fabricantes, categorías,
 * subcategorías, productos e imágenes. NO viajan los binarios: las imágenes y
 * los logos ya viven en Cloudflare R2, que es el mismo bucket que usa la
 * instancia desplegada, y las columnas guardan URLs absolutas.
 *
 * ## Idempotencia
 *
 * Cada entidad se resuelve por su clave natural (`code`, `name`,
 * `productoKey`, `(producto, posición)`), nunca por el id autoincremental, que
 * es distinto en cada base. Repetir la publicación no duplica nada.
 *
 * En destino, `Product.sourceHash` guarda el hash de lo ÚLTIMO publicado, no
 * el hash del DWH: allá no corre ningún sync (el DWH está deshabilitado), así
 * que la columna queda libre para servir de detector de cambios del push y
 * permitir saltar productos que no se movieron.
 *
 * ## Bajas
 *
 * Los productos que existen en destino y ya no en local se desactivan
 * (`active=false`), nunca se borran — mismo criterio que el sync del DWH. Las
 * imágenes sí se borran, porque son referencias reconstruibles.
 */
@Injectable()
export class CatalogPushService {
  private readonly logger = new Logger(CatalogPushService.name);
  private readonly config: PushConfig;
  private readonly localDatabaseUrl: string;

  constructor(
    private readonly local: PrismaService,
    configService: ConfigService,
  ) {
    this.config = configService.getOrThrow<PushConfig>(PUSH_CONFIG);
    this.localDatabaseUrl =
      configService.getOrThrow<DatabaseConfig>(DATABASE_CONFIG).url;
  }

  async run(options: CatalogPushOptions = {}): Promise<CatalogPushSummary> {
    if (!this.config.enabled || !this.config.targetDatabaseUrl) {
      throw new ServiceUnavailableException(
        'La publicación está deshabilitada: define PUSH_TARGET_DATABASE_URL en ' +
          'el .env local con la cadena de conexión pública de la base de Railway.',
      );
    }
    assertDistinctDatabases(
      this.localDatabaseUrl,
      this.config.targetDatabaseUrl,
    );

    const startedAt = Date.now();
    const runDate = new Date();
    const remote = createRemoteCatalogClient(this.config);

    const summary: CatalogPushSummary = {
      runId: 0,
      suppliers: emptyCounters(),
      brands: emptyCounters(),
      manufacturers: emptyCounters(),
      categories: emptyCounters(),
      subcategories: emptyCounters(),
      products: emptyCounters(),
      images: emptyCounters(),
      productsDeactivated: 0,
      imagesRemoved: 0,
      durationMs: 0,
    };

    try {
      await remote.$connect();
      await this.assertRemoteSchemaReady(remote);

      const run = await remote.syncRun.create({
        data: { type: 'catalog-push', status: 'running', startedAt: runDate },
      });
      summary.runId = run.id;
      this.logger.log(`Publicación iniciada (run destino #${run.id})`);

      try {
        // Orden obligado por las llaves foráneas de `products`.
        const supplierIds = await this.pushSuppliers(remote, summary.suppliers);
        const brandIds = await this.pushBrands(remote, summary.brands);
        const manufacturerIds = await this.pushManufacturers(
          remote,
          summary.manufacturers,
        );
        const categoryIds = await this.pushCategories(
          remote,
          summary.categories,
        );
        const subcategoryIds = await this.pushSubcategories(
          remote,
          categoryIds,
          summary.subcategories,
        );

        await this.pushProducts(
          remote,
          {
            suppliers: supplierIds,
            brands: brandIds,
            manufacturers: manufacturerIds,
            categories: categoryIds,
            subcategories: subcategoryIds,
          },
          runDate,
          options,
          summary,
        );

        if (options.limit === undefined) {
          const { count } = await remote.product.updateMany({
            where: { active: true, syncedAt: { lt: runDate } },
            data: { active: false },
          });
          summary.productsDeactivated = count;
        } else {
          this.logger.warn(
            `Publicación parcial (--limit=${options.limit}): se omite la ` +
              'desactivación de productos ausentes para no apagar el resto del catálogo.',
          );
        }

        summary.durationMs = Date.now() - startedAt;

        await remote.syncRun.update({
          where: { id: run.id },
          data: {
            status: 'success',
            finishedAt: new Date(),
            totalRead: summary.products.read,
            inserted: summary.products.inserted,
            updated: summary.products.updated,
            deactivated: summary.productsDeactivated,
            unchanged: summary.products.unchanged,
          },
        });

        this.logger.log(
          `Publicación completada en ${Math.round(summary.durationMs / 1000)}s: ` +
            `${summary.products.read} productos leídos, ` +
            `${summary.products.inserted} nuevos, ${summary.products.updated} actualizados, ` +
            `${summary.products.unchanged} sin cambios, ${summary.productsDeactivated} desactivados`,
        );

        return summary;
      } catch (error) {
        const message = (error as Error).message;
        await remote.syncRun
          .update({
            where: { id: run.id },
            data: {
              status: 'error',
              finishedAt: new Date(),
              totalRead: summary.products.read,
              inserted: summary.products.inserted,
              updated: summary.products.updated,
              unchanged: summary.products.unchanged,
              error: message,
            },
          })
          .catch(() => undefined);
        throw error;
      }
    } finally {
      await remote.$disconnect().catch(() => undefined);
    }
  }

  /**
   * Falla temprano y con un mensaje útil si el destino no tiene el esquema.
   * En Railway lo aplica `docker/entrypoint.sh` con `prisma migrate deploy`.
   */
  private async assertRemoteSchemaReady(remote: PrismaClient): Promise<void> {
    try {
      await remote.product.count();
    } catch (error) {
      throw new Error(
        'La base destino no tiene el esquema del catálogo aplicado ' +
          `(${(error as Error).message}). Despliega la API en Railway —su ` +
          'entrypoint corre `prisma migrate deploy`— o aplica las migraciones a mano.',
      );
    }
  }

  // ------------------------------------------------------------- catálogos base

  /** Proveedores, por `code`. Arrastra el logo comercial si ya se cargó. */
  private async pushSuppliers(
    remote: PrismaClient,
    counters: EntityCounters,
  ): Promise<Map<number, number>> {
    const locals = await this.local.supplier.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        active: true,
        logoObjectKey: true,
        logoUrl: true,
      },
      orderBy: { id: 'asc' },
    });
    counters.read = locals.length;

    const remotes = await remote.supplier.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        active: true,
        logoObjectKey: true,
        logoUrl: true,
      },
    });
    const byCode = new Map(remotes.map((row) => [row.code, row]));

    const toCreate: {
      code: string;
      name: string;
      active: boolean;
      logoObjectKey: string | null;
      logoUrl: string | null;
    }[] = [];

    for (const local of locals) {
      const data = {
        code: local.code,
        name: local.name,
        active: local.active,
        logoObjectKey: local.logoObjectKey,
        logoUrl: local.logoUrl,
      };
      const existing = byCode.get(local.code);

      if (!existing) {
        toCreate.push(data);
        counters.inserted += 1;
      } else if (
        existing.name === data.name &&
        existing.active === data.active &&
        existing.logoObjectKey === data.logoObjectKey &&
        existing.logoUrl === data.logoUrl
      ) {
        counters.unchanged += 1;
      } else {
        await remote.supplier.update({ where: { id: existing.id }, data });
        counters.updated += 1;
      }
    }

    if (toCreate.length > 0) {
      await remote.supplier.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
    }

    const refreshed = await remote.supplier.findMany({
      select: { id: true, code: true },
    });
    const remoteIdByCode = new Map(refreshed.map((row) => [row.code, row.id]));
    return this.mapLocalToRemote(locals, (row) => remoteIdByCode.get(row.code));
  }

  /** Marcas, por `name`. Arrastra el logo comercial si ya se cargó. */
  private async pushBrands(
    remote: PrismaClient,
    counters: EntityCounters,
  ): Promise<Map<number, number>> {
    const locals = await this.local.brand.findMany({
      select: {
        id: true,
        name: true,
        logoObjectKey: true,
        logoUrl: true,
      },
      orderBy: { id: 'asc' },
    });
    counters.read = locals.length;

    const remotes = await remote.brand.findMany({
      select: { id: true, name: true, logoObjectKey: true, logoUrl: true },
    });
    const byName = new Map(remotes.map((row) => [row.name, row]));

    const toCreate: {
      name: string;
      logoObjectKey: string | null;
      logoUrl: string | null;
    }[] = [];

    for (const local of locals) {
      const data = {
        name: local.name,
        logoObjectKey: local.logoObjectKey,
        logoUrl: local.logoUrl,
      };
      const existing = byName.get(local.name);

      if (!existing) {
        toCreate.push(data);
        counters.inserted += 1;
      } else if (
        existing.logoObjectKey === data.logoObjectKey &&
        existing.logoUrl === data.logoUrl
      ) {
        counters.unchanged += 1;
      } else {
        await remote.brand.update({ where: { id: existing.id }, data });
        counters.updated += 1;
      }
    }

    if (toCreate.length > 0) {
      await remote.brand.createMany({ data: toCreate, skipDuplicates: true });
    }

    const refreshed = await remote.brand.findMany({
      select: { id: true, name: true },
    });
    const remoteIdByName = new Map(refreshed.map((row) => [row.name, row.id]));
    return this.mapLocalToRemote(locals, (row) => remoteIdByName.get(row.name));
  }

  /** Fabricantes, por `name`. Solo tienen nombre: nunca hay que actualizarlos. */
  private async pushManufacturers(
    remote: PrismaClient,
    counters: EntityCounters,
  ): Promise<Map<number, number>> {
    const locals = await this.local.manufacturer.findMany({
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
    counters.read = locals.length;

    const remotes = await remote.manufacturer.findMany({
      select: { id: true, name: true },
    });
    const existingNames = new Set(remotes.map((row) => row.name));

    const toCreate = locals
      .filter((row) => !existingNames.has(row.name))
      .map((row) => ({ name: row.name }));
    counters.inserted = toCreate.length;
    counters.unchanged = locals.length - toCreate.length;

    if (toCreate.length > 0) {
      await remote.manufacturer.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
    }

    const refreshed = await remote.manufacturer.findMany({
      select: { id: true, name: true },
    });
    const remoteIdByName = new Map(refreshed.map((row) => [row.name, row.id]));
    return this.mapLocalToRemote(locals, (row) => remoteIdByName.get(row.name));
  }

  /**
   * Categorías, por `name`.
   *
   * Hoy el sync del DWH no las puebla (la categorización es una fase
   * posterior), pero si alguien las cargó en local tienen que viajar: sin
   * ellas, los productos con `categoryId` romperían la llave foránea en destino.
   */
  private async pushCategories(
    remote: PrismaClient,
    counters: EntityCounters,
  ): Promise<Map<number, number>> {
    const locals = await this.local.category.findMany({
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
    counters.read = locals.length;

    const remotes = await remote.category.findMany({
      select: { id: true, name: true },
    });
    const existingNames = new Set(remotes.map((row) => row.name));

    const toCreate = locals
      .filter((row) => !existingNames.has(row.name))
      .map((row) => ({ name: row.name }));
    counters.inserted = toCreate.length;
    counters.unchanged = locals.length - toCreate.length;

    if (toCreate.length > 0) {
      await remote.category.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
    }

    const refreshed = await remote.category.findMany({
      select: { id: true, name: true },
    });
    const remoteIdByName = new Map(refreshed.map((row) => [row.name, row.id]));
    return this.mapLocalToRemote(locals, (row) => remoteIdByName.get(row.name));
  }

  /** Subcategorías, por `(name, categoryId)` ya traducido al id de destino. */
  private async pushSubcategories(
    remote: PrismaClient,
    categoryIds: Map<number, number>,
    counters: EntityCounters,
  ): Promise<Map<number, number>> {
    const locals = await this.local.subcategory.findMany({
      select: { id: true, name: true, categoryId: true },
      orderBy: { id: 'asc' },
    });
    counters.read = locals.length;

    const remotes = await remote.subcategory.findMany({
      select: { id: true, name: true, categoryId: true },
    });
    const key = (name: string, categoryId: number): string =>
      `${categoryId} ${name}`;
    const existingKeys = new Set(
      remotes.map((row) => key(row.name, row.categoryId)),
    );

    const toCreate: { name: string; categoryId: number }[] = [];
    for (const local of locals) {
      const remoteCategoryId = categoryIds.get(local.categoryId);
      if (remoteCategoryId === undefined) continue;

      if (existingKeys.has(key(local.name, remoteCategoryId))) {
        counters.unchanged += 1;
        continue;
      }
      toCreate.push({ name: local.name, categoryId: remoteCategoryId });
      counters.inserted += 1;
    }

    if (toCreate.length > 0) {
      await remote.subcategory.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
    }

    const refreshed = await remote.subcategory.findMany({
      select: { id: true, name: true, categoryId: true },
    });
    const remoteIdByKey = new Map(
      refreshed.map((row) => [key(row.name, row.categoryId), row.id]),
    );
    return this.mapLocalToRemote(locals, (row) => {
      const remoteCategoryId = categoryIds.get(row.categoryId);
      return remoteCategoryId === undefined
        ? undefined
        : remoteIdByKey.get(key(row.name, remoteCategoryId));
    });
  }

  // -------------------------------------------------------------- productos

  private async pushProducts(
    remote: PrismaClient,
    maps: {
      suppliers: Map<number, number>;
      brands: Map<number, number>;
      manufacturers: Map<number, number>;
      categories: Map<number, number>;
      subcategories: Map<number, number>;
    },
    runDate: Date,
    options: CatalogPushOptions,
    summary: CatalogPushSummary,
  ): Promise<void> {
    const counters = summary.products;
    const batchSize = this.config.batchSize;
    let cursorId = 0;

    for (;;) {
      const remaining =
        options.limit === undefined
          ? batchSize
          : Math.min(batchSize, options.limit - counters.read);
      if (remaining <= 0) break;

      // Paginación por cursor sobre el id local: estable y sin OFFSET.
      const batch = await this.local.product.findMany({
        where: { id: { gt: cursorId } },
        orderBy: { id: 'asc' },
        take: remaining,
      });
      if (batch.length === 0) break;
      cursorId = batch[batch.length - 1].id;
      counters.read += batch.length;

      const keys = batch.map((row) => row.productoKey);
      const existing = await remote.product.findMany({
        where: { productoKey: { in: keys } },
        select: { id: true, productoKey: true, sourceHash: true },
      });
      const existingByKey = new Map(
        existing.map((row) => [row.productoKey, row]),
      );

      const toCreate: (RemoteProductData & {
        sourceHash: string;
        syncedAt: Date;
      })[] = [];
      const unchangedKeys: string[] = [];

      for (const local of batch) {
        const data = this.mapProduct(local, maps);
        const hash = hashOf([
          data.productoKey,
          data.sku,
          data.name,
          data.shortDescription,
          data.longDescription,
          data.seoTitle,
          data.seoDescription,
          data.tipoItem,
          data.origen,
          data.linea,
          data.sublinea,
          data.grupo,
          data.pesoKg,
          data.factorEmpaque,
          data.active,
          data.supplierId,
          data.brandId,
          data.manufacturerId,
          data.categoryId,
          data.subcategoryId,
          data.price,
          data.priceCurrency,
          data.priceUpdatedAt,
          data.dwhCreatedAt,
        ]);
        const current = existingByKey.get(local.productoKey);

        if (!current) {
          toCreate.push({ ...data, sourceHash: hash, syncedAt: runDate });
          counters.inserted += 1;
        } else if (current.sourceHash === hash) {
          unchangedKeys.push(local.productoKey);
          counters.unchanged += 1;
        } else {
          await remote.product.update({
            where: { id: current.id },
            data: { ...data, sourceHash: hash, syncedAt: runDate },
          });
          counters.updated += 1;
        }
      }

      if (toCreate.length > 0) {
        await remote.product.createMany({
          data: toCreate,
          skipDuplicates: true,
        });
      }
      if (unchangedKeys.length > 0) {
        // Solo la marca de "visto en esta publicación": la fila no cambió.
        await remote.product.updateMany({
          where: { productoKey: { in: unchangedKeys } },
          data: { syncedAt: runDate },
        });
      }

      if (!options.skipImages) {
        const remoteRows = await remote.product.findMany({
          where: { productoKey: { in: keys } },
          select: { id: true, productoKey: true },
        });
        const remoteIdByKey = new Map(
          remoteRows.map((row) => [row.productoKey, row.id]),
        );
        const remoteIdByLocalId = new Map<number, number>();
        for (const local of batch) {
          const remoteId = remoteIdByKey.get(local.productoKey);
          if (remoteId !== undefined) remoteIdByLocalId.set(local.id, remoteId);
        }
        await this.pushImages(remote, remoteIdByLocalId, summary);
      }

      this.logger.log(
        `Productos publicados: ${counters.read}` +
          (options.limit === undefined ? '' : ` / ${options.limit}`),
      );
    }
  }

  /**
   * Imágenes de un lote de productos, por `(producto, posición)`.
   *
   * Solo viajan las referencias: los binarios (las tres variantes webp) ya
   * están en R2, que es el mismo bucket de la instancia desplegada.
   */
  private async pushImages(
    remote: PrismaClient,
    remoteIdByLocalId: Map<number, number>,
    summary: CatalogPushSummary,
  ): Promise<void> {
    const counters = summary.images;
    const localProductIds = [...remoteIdByLocalId.keys()];
    if (localProductIds.length === 0) return;

    const locals = await this.local.productImage.findMany({
      where: { productId: { in: localProductIds } },
      orderBy: [{ productId: 'asc' }, { position: 'asc' }],
    });
    const remoteProductIds = [...remoteIdByLocalId.values()];
    const remotes = await remote.productImage.findMany({
      where: { productId: { in: remoteProductIds } },
    });

    counters.read += locals.length;

    const key = (productId: number, position: number): string =>
      `${productId}:${position}`;
    const remoteByKey = new Map(
      remotes.map((row) => [key(row.productId, row.position), row]),
    );

    const toCreate: RemoteImageData[] = [];
    const seen = new Set<string>();

    for (const local of locals) {
      const remoteProductId = remoteIdByLocalId.get(local.productId);
      if (remoteProductId === undefined) continue;

      const data: RemoteImageData = {
        productId: remoteProductId,
        objectKey: local.objectKey,
        originalObjectKey: local.originalObjectKey,
        url: local.url,
        thumbUrl: local.thumbUrl,
        cardUrl: local.cardUrl,
        fullUrl: local.fullUrl,
        sourceChecksum: local.sourceChecksum,
        sourceFilename: local.sourceFilename,
        width: local.width,
        height: local.height,
        bytes: local.bytes,
        alt: local.alt,
        position: local.position,
        isPrimary: local.isPrimary,
      };
      const rowKey = key(remoteProductId, local.position);
      seen.add(rowKey);

      const existing = remoteByKey.get(rowKey);
      if (!existing) {
        toCreate.push(data);
        counters.inserted += 1;
        continue;
      }

      const same =
        existing.objectKey === data.objectKey &&
        existing.originalObjectKey === data.originalObjectKey &&
        existing.url === data.url &&
        existing.thumbUrl === data.thumbUrl &&
        existing.cardUrl === data.cardUrl &&
        existing.fullUrl === data.fullUrl &&
        existing.sourceChecksum === data.sourceChecksum &&
        existing.sourceFilename === data.sourceFilename &&
        existing.width === data.width &&
        existing.height === data.height &&
        existing.bytes === data.bytes &&
        existing.alt === data.alt &&
        existing.isPrimary === data.isPrimary;

      if (same) {
        counters.unchanged += 1;
      } else {
        await remote.productImage.update({
          where: { id: existing.id },
          data,
        });
        counters.updated += 1;
      }
    }

    if (toCreate.length > 0) {
      await remote.productImage.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
    }

    // Sobrantes en destino: la imagen se quitó en local. Aquí sí se borra
    // (es una referencia reconstruible, no un dato de negocio).
    const extra = remotes
      .filter((row) => !seen.has(key(row.productId, row.position)))
      .map((row) => row.id);
    if (extra.length > 0) {
      await remote.productImage.deleteMany({ where: { id: { in: extra } } });
      summary.imagesRemoved += extra.length;
    }
  }

  /** Traduce las llaves foráneas locales a los ids de la base destino. */
  private mapProduct(
    local: Product,
    maps: {
      suppliers: Map<number, number>;
      brands: Map<number, number>;
      manufacturers: Map<number, number>;
      categories: Map<number, number>;
      subcategories: Map<number, number>;
    },
  ): RemoteProductData {
    const supplierId = maps.suppliers.get(local.supplierId);
    if (supplierId === undefined) {
      // Imposible salvo que alguien inserte un proveedor mientras corre el
      // push: el proveedor es obligatorio y se publicó antes que el producto.
      throw new Error(
        `El producto ${local.productoKey} referencia un proveedor local ` +
          `(id ${local.supplierId}) que no llegó a la base destino.`,
      );
    }

    const optional = (
      id: number | null,
      map: Map<number, number>,
    ): number | null => (id === null ? null : (map.get(id) ?? null));

    return {
      productoKey: local.productoKey,
      sku: local.sku,
      name: local.name,
      shortDescription: local.shortDescription,
      longDescription: local.longDescription,
      seoTitle: local.seoTitle,
      seoDescription: local.seoDescription,
      tipoItem: local.tipoItem,
      origen: local.origen,
      linea: local.linea,
      sublinea: local.sublinea,
      grupo: local.grupo,
      pesoKg: local.pesoKg,
      factorEmpaque: local.factorEmpaque,
      active: local.active,
      supplierId,
      brandId: optional(local.brandId, maps.brands),
      manufacturerId: optional(local.manufacturerId, maps.manufacturers),
      categoryId: optional(local.categoryId, maps.categories),
      subcategoryId: optional(local.subcategoryId, maps.subcategories),
      price: local.price,
      priceCurrency: local.priceCurrency,
      priceUpdatedAt: local.priceUpdatedAt,
      dwhCreatedAt: local.dwhCreatedAt,
    };
  }

  /** `Map<idLocal, idDestino>` a partir de la clave natural de cada fila. */
  private mapLocalToRemote<T extends { id: number }>(
    locals: readonly T[],
    remoteId: (row: T) => number | undefined,
  ): Map<number, number> {
    const map = new Map<number, number>();
    for (const local of locals) {
      const id = remoteId(local);
      if (id !== undefined) map.set(local.id, id);
    }
    return map;
  }
}
