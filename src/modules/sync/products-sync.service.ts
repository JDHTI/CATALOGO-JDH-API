// Carga el .env ANTES de evaluar el decorador @Cron: los decoradores se
// evalúan al importar el archivo, antes de que ConfigModule procese el
// entorno. dotenv no sobreescribe variables ya definidas.
import { config as loadEnv } from 'dotenv';
loadEnv({ path: ['.env.local', '.env'], quiet: true });

import { createHash } from 'node:crypto';

import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

import { CacheService } from '@infrastructure/cache';
import {
  SYNC_CONFIG,
  SYNC_PRODUCTS_CRON_DEFAULT,
  type SyncConfig,
} from '@infrastructure/config';
import { PrismaService } from '@infrastructure/database';
import { DatawarehouseService } from '@infrastructure/datawarehouse';
import type { Prisma } from '@prisma-client';

import type { DwhProductRow } from './dwh-product-row.interface';

/**
 * Extracción completa del catálogo desde el DWH.
 * - Siempre con el schema calificado (`consumo.productos`), sin depender
 *   de DWH_SCHEMA.
 * - `WHERE sku IS NOT NULL` excluye las filas centinela
 *   ('(desconocido)'/'(no aplica)').
 * - Se importan activos E inactivos (estado → boolean `active`); los
 *   endpoints públicos ya filtran por activos.
 * - ORDER BY producto_key: la paginación por LIMIT/OFFSET del stream
 *   necesita un orden estable.
 */
const PRODUCTS_EXTRACT_SQL = `
  SELECT producto_key, sku, sku_proveedor, descripcion, fecha_creacion,
         estado, tipo_item, cod_proveedor, proveedor, fabricante, marca,
         origen, linea, sublinea, grupo, peso, factor_empaque
  FROM consumo.productos
  WHERE sku IS NOT NULL
  ORDER BY producto_key
`;

const BATCH_SIZE = 1_000;

/**
 * Campos que son propiedad del DWH dentro de `Product`.
 *
 * Los campos editoriales, imágenes, categorías y precios quedan fuera de este
 * tipo a propósito. Mantener la lista explícita hace que una modificación del
 * sync sea revisable y evita que un update del DWH termine sobrescribiendo
 * contenido gestionado por el catálogo.
 */
type DwhManagedProductData = Pick<
  Prisma.ProductCreateManyInput,
  | 'productoKey'
  | 'sku'
  | 'name'
  | 'shortDescription'
  | 'tipoItem'
  | 'origen'
  | 'linea'
  | 'sublinea'
  | 'grupo'
  | 'pesoKg'
  | 'factorEmpaque'
  | 'active'
  | 'supplierId'
  | 'brandId'
  | 'manufacturerId'
  | 'dwhCreatedAt'
>;

/** Proveedor de respaldo para filas sin clasificación en el ERP. */
const FALLBACK_SUPPLIER_CODE = 'SIN_CLASIFICAR';

/** Resumen de una ejecución del sync, para logs y para el script manual. */
export interface ProductsSyncSummary {
  runId: number;
  totalRead: number;
  inserted: number;
  updated: number;
  deactivated: number;
  unchanged: number;
}

interface SyncCounters {
  totalRead: number;
  inserted: number;
  updated: number;
  unchanged: number;
}

/** Caches en memoria de ids de catálogos pequeños durante una ejecución. */
interface LookupCaches {
  suppliers: Map<string, number>;
  brands: Map<string, number>;
  manufacturers: Map<string, number>;
}

/**
 * Sincronización de productos DWH → catálogo.
 *
 * El DWH no expone una fecha de modificación utilizable (fecha_actualizacion
 * es siempre NULL) ni CDC, así que la estrategia es full-extract + upsert
 * idempotente (~27k filas, trivial). La detección de cambios se hace con un
 * hash de los campos mapeados (`sourceHash`): si no cambió, no se reescribe
 * la fila (cuenta como `unchanged`). Los productos que dejan de venir en la
 * extracción se desactivan (soft-deactivate), nunca se borran.
 */
@Injectable()
export class ProductsSyncService implements OnModuleInit {
  private readonly logger = new Logger(ProductsSyncService.name);
  private readonly config: SyncConfig;
  private running = false;

  constructor(
    private readonly dwh: DatawarehouseService,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    configService: ConfigService,
  ) {
    this.config = configService.getOrThrow<SyncConfig>(SYNC_CONFIG);
  }

  onModuleInit(): void {
    if (!this.config.productsEnabled) {
      this.logger.warn(
        'Sincronización de productos deshabilitada (SYNC_PRODUCTS_ENABLED=false)',
      );
      return;
    }
    if (!this.dwh.enabled) {
      this.logger.warn(
        'Sincronización de productos programada pero el DWH está deshabilitado ' +
          '(sin DWH_HOST): el cron no hará nada hasta configurar las DWH_*',
      );
      return;
    }
    this.logger.log(
      `Sincronización de productos programada (cron: ${this.config.productsCron})`,
    );
  }

  /** Ejecución programada. Los errores se registran, nunca tumban la API. */
  @Cron(process.env.SYNC_PRODUCTS_CRON?.trim() || SYNC_PRODUCTS_CRON_DEFAULT, {
    name: 'products-sync',
    waitForCompletion: true,
  })
  async handleCron(): Promise<void> {
    if (!this.config.productsEnabled) return;
    if (!this.dwh.enabled) {
      this.logger.warn(
        'Cron de sincronización omitido: el datawarehouse está deshabilitado',
      );
      return;
    }

    try {
      await this.run();
    } catch (error) {
      this.logger.error(
        `Sincronización programada fallida: ${(error as Error).message}`,
      );
    }
  }

  /** Ejecuta una sincronización completa. La carga inicial es el mismo flujo. */
  async run(): Promise<ProductsSyncSummary> {
    if (!this.dwh.enabled) {
      throw new ServiceUnavailableException(
        'El datawarehouse está deshabilitado: define las variables DWH_* en el ' +
          '.env (host, base, usuario y contraseña) para poder sincronizar.',
      );
    }
    if (this.running) {
      throw new ServiceUnavailableException(
        'Ya hay una sincronización de productos en curso.',
      );
    }
    this.running = true;

    // Fecha única de la ejecución (reloj de la app): todo producto visto en
    // la extracción queda con syncedAt = runDate, y al final se desactiva lo
    // que quedó con syncedAt anterior (no vino en la extracción).
    const runDate = new Date();
    const run = await this.prisma.syncRun.create({
      data: { type: 'products', status: 'running', startedAt: runDate },
    });

    const counters: SyncCounters = {
      totalRead: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
    };
    const caches: LookupCaches = {
      suppliers: new Map(),
      brands: new Map(),
      manufacturers: new Map(),
    };

    this.logger.log(`Sincronización de productos iniciada (run #${run.id})`);

    try {
      for await (const batch of this.dwh.stream<DwhProductRow>(
        PRODUCTS_EXTRACT_SQL,
        [],
        BATCH_SIZE,
      )) {
        await this.processBatch(batch, runDate, counters, caches);
        counters.totalRead += batch.length;
      }

      const { count: deactivated } = await this.prisma.product.updateMany({
        where: { active: true, syncedAt: { lt: runDate } },
        data: { active: false },
      });

      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: 'success',
          finishedAt: new Date(),
          totalRead: counters.totalRead,
          inserted: counters.inserted,
          updated: counters.updated,
          deactivated,
          unchanged: counters.unchanged,
        },
      });

      const changes = counters.inserted + counters.updated + deactivated;
      if (changes > 0) {
        // Las claves del HttpCacheInterceptor empiezan por "http:".
        await this.cache.invalidateByPrefix('http:');
      }

      const summary: ProductsSyncSummary = {
        runId: run.id,
        totalRead: counters.totalRead,
        inserted: counters.inserted,
        updated: counters.updated,
        deactivated,
        unchanged: counters.unchanged,
      };
      this.logger.log(
        `Sincronización completada: ${summary.totalRead} leídos, ` +
          `${summary.inserted} nuevos, ${summary.updated} actualizados, ` +
          `${summary.unchanged} sin cambios, ${summary.deactivated} desactivados`,
      );
      return summary;
    } catch (error) {
      const message = (error as Error).message;
      await this.prisma.syncRun
        .update({
          where: { id: run.id },
          data: {
            status: 'error',
            finishedAt: new Date(),
            totalRead: counters.totalRead,
            inserted: counters.inserted,
            updated: counters.updated,
            unchanged: counters.unchanged,
            error: message,
          },
        })
        .catch(() => undefined);
      this.logger.error(`Sincronización fallida: ${message}`);
      throw error;
    } finally {
      this.running = false;
    }
  }

  /** Procesa un lote: catálogos de apoyo primero, luego upsert de productos. */
  private async processBatch(
    batch: DwhProductRow[],
    runDate: Date,
    counters: SyncCounters,
    caches: LookupCaches,
  ): Promise<void> {
    await this.upsertSuppliers(batch, caches.suppliers);
    await this.upsertByName(batch, 'marca', 'brand', caches.brands);
    await this.upsertByName(
      batch,
      'fabricante',
      'manufacturer',
      caches.manufacturers,
    );

    const keys = batch.map((row) => row.producto_key);
    const existing = await this.prisma.product.findMany({
      where: { productoKey: { in: keys } },
      select: { productoKey: true, sourceHash: true },
    });
    const existingByKey = new Map(
      existing.map((product) => [product.productoKey, product.sourceHash]),
    );

    const toCreate: Prisma.ProductCreateManyInput[] = [];
    const unchangedKeys: string[] = [];

    for (const row of batch) {
      const data = this.mapRow(row, caches);
      const sourceHash = this.hashSource(data);
      const currentHash = existingByKey.get(row.producto_key);

      if (currentHash === undefined) {
        toCreate.push({ ...data, sourceHash, syncedAt: runDate });
        counters.inserted += 1;
      } else if (currentHash === sourceHash) {
        unchangedKeys.push(row.producto_key);
        counters.unchanged += 1;
      } else {
        await this.prisma.product.update({
          where: { productoKey: row.producto_key },
          data: {
            ...this.toDwhUpdateData(data),
            sourceHash,
            syncedAt: runDate,
          },
        });
        counters.updated += 1;
      }
    }

    if (toCreate.length > 0) {
      await this.prisma.product.createMany({ data: toCreate });
    }
    if (unchangedKeys.length > 0) {
      // Solo se toca la marca de "visto en esta ejecución"; la fila no cambió.
      await this.prisma.product.updateMany({
        where: { productoKey: { in: unchangedKeys } },
        data: { syncedAt: runDate },
      });
    }
  }

  /**
   * Upsert de los proveedores del lote (una vez por código y ejecución).
   *
   * "Proveedor" es la clasificación comercial del ERP (criterio mayor t106),
   * no una identidad jurídica: es el criterio de agrupación del catálogo.
   */
  private async upsertSuppliers(
    batch: DwhProductRow[],
    cache: Map<string, number>,
  ): Promise<void> {
    for (const row of batch) {
      const code = row.cod_proveedor?.trim() || FALLBACK_SUPPLIER_CODE;
      if (cache.has(code)) continue;

      const name = row.proveedor?.trim() || code;
      const supplier = await this.prisma.supplier.upsert({
        where: { code },
        create: { code, name },
        update: { name },
        select: { id: true },
      });
      cache.set(code, supplier.id);
    }
  }

  /** Upsert genérico de Brand/Manufacturer por nombre (trim, ignora vacíos). */
  private async upsertByName(
    batch: DwhProductRow[],
    column: 'marca' | 'fabricante',
    model: 'brand' | 'manufacturer',
    cache: Map<string, number>,
  ): Promise<void> {
    for (const row of batch) {
      const name = row[column]?.trim();
      if (!name || cache.has(name)) continue;

      const args = {
        where: { name },
        create: { name },
        update: {},
        select: { id: true } as const,
      };
      const record =
        model === 'brand'
          ? await this.prisma.brand.upsert(args)
          : await this.prisma.manufacturer.upsert(args);
      cache.set(name, record.id);
    }
  }

  /**
   * Quita los símbolos de adorno del INICIO del nombre que arrastra el ERP
   * ('*Vaso 7oz Nescafe' → 'Vaso 7oz Nescafe').
   *
   * Solo recorta al principio y solo caracteres que no son letra ni dígito: el
   * resto del texto se conserva intacto a propósito, porque lleva unidades,
   * medidas y códigos de fabricante que cualquier normalización rompería
   * ('18ux8.5g', 'Confitero14"', 'FGWHB14EBK').
   */
  static cleanName(value: string): string {
    return value
      .trim()
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .trim();
  }

  /** Mapea una fila del DWH a los campos del producto del catálogo. */
  private mapRow(
    row: DwhProductRow,
    caches: LookupCaches,
  ): DwhManagedProductData {
    const supplierCode = row.cod_proveedor?.trim() || FALLBACK_SUPPLIER_CODE;
    const brandName = row.marca?.trim();
    const manufacturerName = row.fabricante?.trim();
    const sku = row.sku.trim();

    return {
      productoKey: row.producto_key,
      sku,
      name: ProductsSyncService.cleanName(row.descripcion ?? '') || sku,
      shortDescription: row.sku_proveedor?.trim() || null,
      tipoItem: row.tipo_item?.trim() || null,
      origen: row.origen?.trim() || null,
      linea: row.linea?.trim() || null,
      sublinea: row.sublinea?.trim() || null,
      grupo: row.grupo?.trim() || null,
      pesoKg: row.peso ?? null,
      factorEmpaque: row.factor_empaque ?? null,
      active: row.estado?.trim() === 'A',
      supplierId: caches.suppliers.get(supplierCode)!,
      brandId: brandName ? (caches.brands.get(brandName) ?? null) : null,
      manufacturerId: manufacturerName
        ? (caches.manufacturers.get(manufacturerName) ?? null)
        : null,
      dwhCreatedAt: row.fecha_creacion,
    };
  }

  /**
   * Proyección explícita para actualizar una fila existente.
   *
   * `createMany` necesita todos los campos mínimos de una fila nueva, pero un
   * update nunca debe reutilizar ese objeto por propagación accidental. Esta
   * proyección es la frontera entre datos del DWH y datos propios del catálogo.
   */
  private toDwhUpdateData(
    data: DwhManagedProductData,
  ): Prisma.ProductUncheckedUpdateInput {
    return {
      sku: data.sku,
      name: data.name,
      shortDescription: data.shortDescription,
      tipoItem: data.tipoItem,
      origen: data.origen,
      linea: data.linea,
      sublinea: data.sublinea,
      grupo: data.grupo,
      pesoKg: data.pesoKg,
      factorEmpaque: data.factorEmpaque,
      active: data.active,
      supplierId: data.supplierId,
      brandId: data.brandId,
      manufacturerId: data.manufacturerId,
      dwhCreatedAt: data.dwhCreatedAt,
    };
  }

  /** Hash estable de los campos mapeados, para saltar updates sin cambios. */
  private hashSource(
    data: Omit<Prisma.ProductCreateManyInput, 'sourceHash' | 'syncedAt'>,
  ): string {
    return createHash('sha1')
      .update(
        JSON.stringify([
          data.productoKey,
          data.sku,
          data.name,
          data.shortDescription,
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
          data.dwhCreatedAt instanceof Date
            ? data.dwhCreatedAt.toISOString()
            : data.dwhCreatedAt,
        ]),
      )
      .digest('hex');
  }
}
