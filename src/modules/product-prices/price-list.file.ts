import { readFileSync } from 'node:fs';

/** Lista de precios de empleados JDH (la calcula la intranet). */
export const EMPLOYEE_PRICE_LIST = 'empleados-jdh';

/** Un SKU de la lista, ya validado. Los importes quedan como texto decimal. */
export interface PriceListItem {
  sku: string;
  inventoryUnit: string | null;
  price: string;
  /** "19", "5", "0" (sin IVA) o `null` (tasa desconocida: IVA por confirmar). */
  vatPct: string | null;
  /** Etiqueta de la fuente ("IVA 19 %", "Sin IVA"); `null` si no la trae. */
  vatLabel: string | null;
  priceWithVat: string;
}

/**
 * Etiqueta de IVA para mostrar. 0 y `null` NO son lo mismo: 0 es «Sin IVA»
 * (se factura al 0 %), `null` es una tasa que la fuente no conoce.
 */
export function vatLabelFor(vatPct: number | null): string {
  if (vatPct === null) return 'IVA por confirmar';
  if (vatPct === 0) return 'Sin IVA';
  return `IVA ${vatPct} %`;
}

/** Archivo de lista de precios validado. */
export interface PriceListFile {
  list: string;
  currency: string;
  generatedAt: Date;
  /** `YYYY-MM-DD` de la foto de costos. */
  snapshotDate: string;
  items: PriceListItem[];
}

const DECIMAL = /^\d+(\.\d+)?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida el archivo completo ANTES de escribir nada: un archivo truncado o mal
 * formado no debe dejar la lista a medias ni vaciarla. Cualquier fila mala
 * aborta la carga entera, con todas las filas malas en el mensaje.
 *
 * El costo y el margen no forman parte del contrato: si la fuente los enviara,
 * se ignoran (nunca se guardan).
 */
export function parsePriceList(raw: unknown): PriceListFile {
  const problems: string[] = [];
  const root = asRecord(raw);
  if (!root) throw new Error('El archivo no es un objeto JSON');

  const list = text(root.list);
  const currency = text(root.currency);
  const generatedAtText = text(root.generated_at);
  const snapshotDate = text(root.snapshot_date);
  const generatedAt = generatedAtText ? new Date(generatedAtText) : null;

  if (!list) problems.push('falta "list"');
  if (!currency) problems.push('falta "currency"');
  if (!generatedAt || Number.isNaN(generatedAt.getTime())) {
    problems.push('"generated_at" no es una fecha ISO');
  }
  if (!snapshotDate || !DATE_ONLY.test(snapshotDate)) {
    problems.push('"snapshot_date" no es YYYY-MM-DD');
  }
  if (!Array.isArray(root.items)) {
    throw new Error(
      `Archivo inválido: ${[...problems, 'falta "items"'].join('; ')}`,
    );
  }
  if (typeof root.total === 'number' && root.total !== root.items.length) {
    problems.push(
      `"total" dice ${root.total} pero "items" trae ${root.items.length} (¿archivo truncado?)`,
    );
  }

  const items: PriceListItem[] = [];
  const seen = new Set<string>();
  root.items.forEach((value, index) => {
    const item = asRecord(value);
    const sku = item ? text(item.sku) : null;
    const where = `items[${index}]${sku ? ` (sku ${sku})` : ''}`;
    if (!item || !sku) {
      problems.push(`${where}: falta "sku"`);
      return;
    }
    if (seen.has(sku)) {
      problems.push(`${where}: SKU repetido`);
      return;
    }
    seen.add(sku);

    // `vat_pct` = "0" es un IVA conocido (grupo SIN IVA de SIESA) y `null` es
    // un IVA desconocido: se comparan siempre contra `null`, nunca por
    // falsedad, para que el 0 no se pierda por el camino.
    const price = decimal(item.price);
    const vatUnknown = item.vat_pct === null;
    const vatPct = vatUnknown ? null : decimal(item.vat_pct);
    const priceWithVat = decimal(item.price_with_vat);
    if (price === null) problems.push(`${where}: "price" no es un decimal`);
    if (!vatUnknown && vatPct === null) {
      problems.push(`${where}: "vat_pct" no es un decimal ni null`);
    }
    if (priceWithVat === null) {
      problems.push(`${where}: "price_with_vat" no es un decimal`);
    }
    if (price === null || priceWithVat === null) return;
    if (!vatUnknown && vatPct === null) return;
    if (vatUnknown && Number(priceWithVat) !== Number(price)) {
      problems.push(
        `${where}: sin "vat_pct" el "price_with_vat" debe ser igual a "price"`,
      );
      return;
    }

    items.push({
      sku,
      inventoryUnit: text(item.inventory_unit),
      price,
      vatPct,
      vatLabel: text(item.vat_label),
      priceWithVat,
    });
  });

  if (problems.length > 0) {
    const shown = problems.slice(0, 20).join('; ');
    const more = problems.length > 20 ? ` (y ${problems.length - 20} más)` : '';
    throw new Error(`Archivo inválido: ${shown}${more}`);
  }

  return {
    list: list!,
    currency: currency!,
    generatedAt: generatedAt!,
    snapshotDate: snapshotDate!,
    items,
  };
}

/** Lee y valida un archivo de lista de precios del disco. */
export function readPriceListFile(path: string): PriceListFile {
  return parsePriceList(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

/** Texto decimal no negativo, normalizado sin ceros a la izquierda. */
function decimal(value: unknown): string | null {
  const raw = text(value);
  if (!raw || !DECIMAL.test(raw)) return null;
  return raw.replace(/^0+(?=\d)/, '');
}
