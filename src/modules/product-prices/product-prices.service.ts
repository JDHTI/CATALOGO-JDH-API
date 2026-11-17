import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '@infrastructure/database';
import { Prisma } from '@prisma-client';

import {
  vatLabelFor,
  type PriceListFile,
  type PriceListItem,
} from './price-list.file';

/** Resultado de una carga. */
export interface PriceListLoadSummary {
  list: string;
  snapshotDate: string;
  generatedAt: string;
  dryRun: boolean;
  /** SKUs en el archivo. */
  read: number;
  /** SKUs nuevos en la lista. */
  inserted: number;
  /** SKUs cuyo precio, IVA, unidad o producto resuelto cambió. */
  changed: number;
  unchanged: number;
  /** SKUs que estaban en la lista y ya no vienen: se quitan de la lista. */
  removed: number;
  /** SKUs del archivo con producto en el catálogo (se mostrarán si está activo). */
  matched: number;
  /** De `matched`, cuántos productos están inactivos (no se ven en el catálogo). */
  matchedInactive: number;
  /** SKUs del archivo que no existen en el catálogo. */
  notInCatalog: number;
  /** SKUs que coinciden con más de un producto: no se asignan a ninguno. */
  ambiguous: number;
  notInCatalogSample: string[];
  ambiguousSample: string[];
  /**
   * SKUs por tarifa de IVA: "19", "5", "0" (sin IVA) y "desconocido" (null,
   * IVA por confirmar). El 0 y el desconocido se cuentan por separado.
   */
  vatRates: Record<string, number>;
}

/** Precio de empleado listo para la respuesta pública de productos. */
export interface EmployeePrice {
  precio: number;
  precioConIva: number;
  /** 0 = sin IVA; 
ull = tasa desconocida (IVA por confirmar). */
  ivaPct: number | null;
  /** "IVA 19 %", "IVA 5 %", "Sin IVA" o "IVA por confirmar". */
  ivaEtiqueta: string;
  moneda: string;
  unidad: string | null;
  fechaFoto: string;
}

interface Resolution {
  productoKey: string | null;
  status: 'matched' | 'missing' | 'ambiguous';
  active: boolean;
}

const SAMPLE_SIZE = 20;

/**
 * Listas de precios externas al DWH. La tabla `product_list_prices` es propia:
 * el sync de productos no la toca, y esta clase nunca escribe en `products`.
 */
@Injectable()
export class ProductPricesService {
  private readonly logger = new Logger(ProductPricesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Carga idempotente de una lista completa: upsert por (lista, SKU) y baja de
   * los SKUs que dejan de venir. Repetir el mismo archivo no cambia nada salvo
   * `loaded_at`.
   *
   * Rechaza un archivo más viejo que el ya cargado (protege de restaurar una
   * foto anterior por error) salvo con `force`.
   */
  async load(
    file: PriceListFile,
    options: { dryRun?: boolean; force?: boolean } = {},
  ): Promise<PriceListLoadSummary> {
    const latest = await this.prisma.productListPrice.aggregate({
      where: { list: file.list },
      _max: { generatedAt: true },
    });
    const current = latest._max.generatedAt;
    if (current && file.generatedAt < current && !options.force) {
      throw new Error(
        `El archivo (${file.generatedAt.toISOString()}) es anterior a la lista vigente ` +
          `(${current.toISOString()}). Usa --force si de verdad quieres volver atrás.`,
      );
    }

    const resolutions = await this.resolveSkus(file.items.map((i) => i.sku));
    const existing = new Map(
      (
        await this.prisma.productListPrice.findMany({
          where: { list: file.list },
          select: {
            sku: true,
            productoKey: true,
            inventoryUnit: true,
            price: true,
            vatPct: true,
            vatLabel: true,
            priceWithVat: true,
            currency: true,
          },
        })
      ).map((row) => [row.sku, row]),
    );

    const summary: PriceListLoadSummary = {
      list: file.list,
      snapshotDate: file.snapshotDate,
      generatedAt: file.generatedAt.toISOString(),
      dryRun: Boolean(options.dryRun),
      read: file.items.length,
      inserted: 0,
      changed: 0,
      unchanged: 0,
      removed: 0,
      matched: 0,
      matchedInactive: 0,
      notInCatalog: 0,
      ambiguous: 0,
      notInCatalogSample: [],
      ambiguousSample: [],
      vatRates: {},
    };

    for (const item of file.items) {
      const resolution = resolutions.get(item.sku)!;
      this.countResolution(summary, item.sku, resolution);
      const rate = item.vatPct ?? 'desconocido';
      summary.vatRates[rate] = (summary.vatRates[rate] ?? 0) + 1;

      const before = existing.get(item.sku);
      if (!before) {
        summary.inserted++;
      } else if (
        isChanged(before, item, resolution.productoKey, file.currency)
      ) {
        summary.changed++;
      } else {
        summary.unchanged++;
      }
    }
    const incoming = new Set(file.items.map((item) => item.sku));
    const removedSkus = [...existing.keys()].filter(
      (sku) => !incoming.has(sku),
    );
    summary.removed = removedSkus.length;

    if (options.dryRun) return summary;

    const loadedAt = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        await this.upsert(tx, file, resolutions, loadedAt);
        if (removedSkus.length > 0) {
          await tx.productListPrice.deleteMany({
            where: { list: file.list, sku: { in: removedSkus } },
          });
        }
      },
      { timeout: 120_000 },
    );

    this.logger.log(`Lista ${file.list} cargada: ${JSON.stringify(summary)}`);
    return summary;
  }

  /**
   * Precio de la lista para cada producto pedido, por id de producto. Los que
   * no están en la lista no aparecen en el mapa.
   */
  async findForProducts(
    list: string,
    productIds: readonly number[],
  ): Promise<Map<number, EmployeePrice>> {
    if (productIds.length === 0) return new Map();

    const rows = await this.prisma.$queryRaw<
      {
        id: number;
        price: Prisma.Decimal;
        vat_pct: Prisma.Decimal | null;
        vat_label: string | null;
        price_with_vat: Prisma.Decimal;
        currency: string;
        inventory_unit: string | null;
        snapshot_date: Date;
      }[]
    >`
      SELECT p.id, lp.price, lp.vat_pct, lp.vat_label, lp.price_with_vat, lp.currency,
             lp.inventory_unit, lp.snapshot_date
      FROM products p
      JOIN product_list_prices lp
        ON lp.producto_key = p.producto_key AND lp.list = ${list}
      WHERE p.id = ANY(${[...productIds]}::int[])
    `;

    return new Map(
      rows.map((row) => {
        const ivaPct = row.vat_pct === null ? null : Number(row.vat_pct);
        return [
          row.id,
          {
            precio: Number(row.price),
            precioConIva: Number(row.price_with_vat),
            ivaPct,
            // La etiqueta de la fuente manda; si no la trae, se deriva igual.
            ivaEtiqueta: row.vat_label ?? vatLabelFor(ivaPct),
            moneda: row.currency,
            unidad: row.inventory_unit,
            fechaFoto: row.snapshot_date.toISOString().slice(0, 10),
          },
        ];
      }),
    );
  }

  /**
   * SKU → producto. El SKU no es único entre compañías: con un solo producto
   * se asigna; con varios, se prefiere el único activo; si sigue habiendo más
   * de uno, queda sin asignar (mejor sin precio que con el de otro producto).
   */
  private async resolveSkus(skus: string[]): Promise<Map<string, Resolution>> {
    const products = await this.prisma.product.findMany({
      where: { sku: { in: skus } },
      select: { sku: true, productoKey: true, active: true },
    });
    const bySku = new Map<string, typeof products>();
    for (const product of products) {
      bySku.set(product.sku, [...(bySku.get(product.sku) ?? []), product]);
    }

    return new Map(
      skus.map((sku): [string, Resolution] => {
        const candidates = bySku.get(sku) ?? [];
        if (candidates.length === 0) {
          return [sku, { productoKey: null, status: 'missing', active: false }];
        }
        const active = candidates.filter((c) => c.active);
        const pick =
          candidates.length === 1
            ? candidates[0]
            : active.length === 1
              ? active[0]
              : null;
        return [
          sku,
          pick
            ? {
                productoKey: pick.productoKey,
                status: 'matched',
                active: pick.active,
              }
            : { productoKey: null, status: 'ambiguous', active: false },
        ];
      }),
    );
  }

  private countResolution(
    summary: PriceListLoadSummary,
    sku: string,
    resolution: Resolution,
  ): void {
    if (resolution.status === 'matched') {
      summary.matched++;
      if (!resolution.active) summary.matchedInactive++;
    } else if (resolution.status === 'missing') {
      summary.notInCatalog++;
      if (summary.notInCatalogSample.length < SAMPLE_SIZE) {
        summary.notInCatalogSample.push(sku);
      }
    } else {
      summary.ambiguous++;
      if (summary.ambiguousSample.length < SAMPLE_SIZE) {
        summary.ambiguousSample.push(sku);
      }
    }
  }

  /**
   * Un solo `INSERT ... ON CONFLICT` para toda la lista. `updated_at` solo se
   * mueve en las filas que cambiaron de verdad; `loaded_at`, `generated_at` y
   * `snapshot_date` se renuevan en todas (la carga las confirmó).
   */
  private async upsert(
    tx: Prisma.TransactionClient,
    file: PriceListFile,
    resolutions: Map<string, Resolution>,
    loadedAt: Date,
  ): Promise<void> {
    const column = <T>(pick: (item: PriceListItem) => T): T[] =>
      file.items.map(pick);

    await tx.$executeRaw`
      INSERT INTO product_list_prices (
        list, sku, producto_key, inventory_unit, price, vat_pct, vat_label, price_with_vat,
        currency, generated_at, snapshot_date, loaded_at, updated_at
      )
      SELECT ${file.list}, i.sku, i.producto_key, i.inventory_unit,
             i.price::numeric, i.vat_pct::numeric, i.vat_label, i.price_with_vat::numeric,
             ${file.currency}, ${file.generatedAt}, ${file.snapshotDate}::date,
             ${loadedAt}, ${loadedAt}
      FROM unnest(
        ${column((i) => i.sku)}::text[],
        ${column((i) => resolutions.get(i.sku)!.productoKey)}::text[],
        ${column((i) => i.inventoryUnit)}::text[],
        ${column((i) => i.price)}::text[],
        ${column((i) => i.vatPct)}::text[],
        ${column((i) => i.vatLabel)}::text[],
        ${column((i) => i.priceWithVat)}::text[]
      ) AS i(sku, producto_key, inventory_unit, price, vat_pct, vat_label, price_with_vat)
      ON CONFLICT (list, sku) DO UPDATE SET
        producto_key   = EXCLUDED.producto_key,
        inventory_unit = EXCLUDED.inventory_unit,
        price          = EXCLUDED.price,
        vat_pct        = EXCLUDED.vat_pct,
        vat_label      = EXCLUDED.vat_label,
        price_with_vat = EXCLUDED.price_with_vat,
        currency       = EXCLUDED.currency,
        generated_at   = EXCLUDED.generated_at,
        snapshot_date  = EXCLUDED.snapshot_date,
        loaded_at      = EXCLUDED.loaded_at,
        updated_at     = CASE
          WHEN (product_list_prices.producto_key, product_list_prices.inventory_unit,
                product_list_prices.price, product_list_prices.vat_pct, product_list_prices.vat_label,
                product_list_prices.price_with_vat, product_list_prices.currency)
               IS DISTINCT FROM
               (EXCLUDED.producto_key, EXCLUDED.inventory_unit, EXCLUDED.price,
                EXCLUDED.vat_pct, EXCLUDED.vat_label, EXCLUDED.price_with_vat, EXCLUDED.currency)
          THEN EXCLUDED.updated_at
          ELSE product_list_prices.updated_at
        END
    `;
  }
}

function isChanged(
  before: {
    productoKey: string | null;
    inventoryUnit: string | null;
    price: Prisma.Decimal;
    vatPct: Prisma.Decimal | null;
    vatLabel: string | null;
    priceWithVat: Prisma.Decimal;
    currency: string;
  },
  item: PriceListItem,
  productoKey: string | null,
  currency: string,
): boolean {
  return (
    before.productoKey !== productoKey ||
    before.inventoryUnit !== item.inventoryUnit ||
    before.vatLabel !== item.vatLabel ||
    before.currency !== currency ||
    !before.price.equals(item.price) ||
    !before.priceWithVat.equals(item.priceWithVat) ||
    // 0 y null son distintos: pasar de null a 0 (o al revés) es un cambio.
    (before.vatPct === null
      ? item.vatPct !== null
      : item.vatPct === null || !before.vatPct.equals(item.vatPct))
  );
}
