import { vatLabelFor } from './price-list.file';

/**
 * Foto del precio que una línea del carrito guarda AL AGREGARSE. El resumen se
 * calcula siempre con esta foto, no con la lista vigente: si la lista se
 * recarga después, el carrito no cambia en silencio. Para avisar de un cambio,
 * compárala con el `precioEmpleado` actual (`priceSnapshotChanged`).
 */
export interface PriceSnapshot {
  /** Lista de la que salió (p. ej. 'empleados-jdh'). */
  lista: string;
  /** Precio unitario sin IVA, en pesos enteros. */
  precio: number;
  /** 0 = sin IVA; `null` = tasa desconocida (IVA por confirmar). */
  ivaPct: number | null;
  /** Fecha de la foto de costos (YYYY-MM-DD). */
  fechaFoto: string;
}

export interface CartLineInput {
  productoId: number;
  cantidad: number;
  precio: PriceSnapshot;
}

export interface CartLineSummary {
  productoId: number;
  cantidad: number;
  ivaPct: number | null;
  /** precio × cantidad. */
  base: number;
  /** redondeo(base × ivaPct / 100), mitad hacia arriba; 0 si ivaPct es null. */
  iva: number;
}

/** Una tarifa de IVA conocida (19 %, 5 %, 0 %). */
export interface VatRateSummary {
  ivaPct: number;
  etiqueta: string;
  base: number;
  iva: number;
}

export interface CartSummary {
  lineas: CartLineSummary[];
  /** Σ bases de todas las líneas (incluidas las de IVA por confirmar). */
  subtotal: number;
  /** Tarifas conocidas, de mayor a menor; «Sin IVA» va al final con IVA 0. */
  tarifas: VatRateSummary[];
  /**
   * Líneas cuya tasa no se conoce: se muestran aparte («IVA por confirmar»),
   * nunca mezcladas con Sin IVA. `null` si no hay ninguna.
   */
  ivaPorConfirmar: { base: number; lineas: number } | null;
  /** Σ IVA de las tarifas conocidas. */
  iva: number;
  /**
   * Impuestos distintos del IVA (IBUA, consumo de licores…). La lista de
   * precios todavía no los trae: queda vacío hasta que la fuente los envíe.
   */
  otrosImpuestos: { etiqueta: string; valor: number }[];
  /** subtotal + iva + Σ otrosImpuestos. */
  total: number;
}

/**
 * Resumen del carrito calculado como una factura: el IVA se redondea POR LÍNEA
 * sobre la base (precio × cantidad), no por unidad. Sumar `precioConIva ×
 * cantidad` se aleja del valor facturado en cantidades grandes.
 */
export function summarizeCart(lines: readonly CartLineInput[]): CartSummary {
  const lineas = lines.map(summarizeLine);
  const byRate = new Map<number, VatRateSummary>();
  const pending = { base: 0, lineas: 0 };

  for (const line of lineas) {
    if (line.ivaPct === null) {
      pending.base += line.base;
      pending.lineas++;
      continue;
    }
    const rate = byRate.get(line.ivaPct) ?? {
      ivaPct: line.ivaPct,
      etiqueta: vatLabelFor(line.ivaPct),
      base: 0,
      iva: 0,
    };
    rate.base += line.base;
    rate.iva += line.iva;
    byRate.set(line.ivaPct, rate);
  }

  const tarifas = [...byRate.values()].sort((a, b) => b.ivaPct - a.ivaPct);
  const subtotal = sum(lineas.map((line) => line.base));
  const iva = sum(tarifas.map((rate) => rate.iva));
  const otrosImpuestos: CartSummary['otrosImpuestos'] = [];

  return {
    lineas,
    subtotal,
    tarifas,
    ivaPorConfirmar: pending.lineas > 0 ? pending : null,
    iva,
    otrosImpuestos,
    total: subtotal + iva + sum(otrosImpuestos.map((tax) => tax.valor)),
  };
}

/** `true` si el precio vigente ya no coincide con la foto guardada en la línea. */
export function priceSnapshotChanged(
  snapshot: PriceSnapshot,
  current: { precio: number; ivaPct: number | null } | null,
): boolean {
  return (
    current === null ||
    current.precio !== snapshot.precio ||
    current.ivaPct !== snapshot.ivaPct
  );
}

function summarizeLine(line: CartLineInput): CartLineSummary {
  const { precio, ivaPct } = line.precio;
  if (!Number.isInteger(line.cantidad) || line.cantidad <= 0) {
    throw new Error(`Cantidad inválida en el producto ${line.productoId}`);
  }
  if (!Number.isInteger(precio) || precio < 0) {
    throw new Error(`Precio no entero en el producto ${line.productoId}`);
  }

  const base = precio * line.cantidad;
  return {
    productoId: line.productoId,
    cantidad: line.cantidad,
    ivaPct,
    base,
    iva: ivaPct === null ? 0 : vatHalfUp(base, ivaPct),
  };
}

/**
 * base × pct / 100 redondeado a pesos, mitad hacia arriba, en aritmética
 * entera (la tasa se lleva a centésimas) para que 0,5 nunca caiga del lado
 * equivocado por un error de coma flotante.
 */
export function vatHalfUp(base: number, pct: number): number {
  const hundredths = Math.round(pct * 100);
  return Math.floor((base * hundredths + 5_000) / 10_000);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
