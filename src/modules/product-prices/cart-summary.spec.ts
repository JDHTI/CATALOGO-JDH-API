import {
  priceSnapshotChanged,
  summarizeCart,
  vatHalfUp,
  type CartLineInput,
} from './cart-summary';

const line = (
  productoId: number,
  precio: number,
  ivaPct: number | null,
  cantidad: number,
): CartLineInput => ({
  productoId,
  cantidad,
  precio: { lista: 'empleados-jdh', precio, ivaPct, fechaFoto: '2026-11-17' },
});

describe('summarizeCart', () => {
  it('agrupa por tarifa, separa Sin IVA y suma como una factura', () => {
    const summary = summarizeCart([
      line(1, 49863, 19, 3), // base 149589, iva 28421.91 → 28422
      line(2, 4211, 19, 2), // base 8422, iva 1600.18 → 1600
      line(3, 10000, 5, 1), // base 10000, iva 500
      line(4, 7816, 0, 4), // base 31264, iva 0
    ]);

    expect(summary.subtotal).toBe(149589 + 8422 + 10000 + 31264);
    expect(summary.tarifas).toEqual([
      { ivaPct: 19, etiqueta: 'IVA 19 %', base: 158011, iva: 30022 },
      { ivaPct: 5, etiqueta: 'IVA 5 %', base: 10000, iva: 500 },
      { ivaPct: 0, etiqueta: 'Sin IVA', base: 31264, iva: 0 },
    ]);
    expect(summary.iva).toBe(30522);
    expect(summary.total).toBe(summary.subtotal + 30522);
    expect(summary.ivaPorConfirmar).toBeNull();
    expect(summary.otrosImpuestos).toEqual([]);
  });

  it('redondea el IVA por línea, no por unidad', () => {
    // 1 unidad: 4211 × 1,19 = 5011,09 → 5011. × 1000 = 5.011.000,
    // pero el IVA de la línea es 4.211.000 × 0,19 = 800.090.
    const summary = summarizeCart([line(1, 4211, 19, 1000)]);

    expect(summary.total).toBe(4_211_000 + 800_090);
    expect(summary.total).not.toBe(5011 * 1000);
  });

  it('IVA null va a «por confirmar», no a Sin IVA', () => {
    const summary = summarizeCart([line(1, 1000, null, 2), line(2, 500, 0, 1)]);

    expect(summary.tarifas).toEqual([
      { ivaPct: 0, etiqueta: 'Sin IVA', base: 500, iva: 0 },
    ]);
    expect(summary.ivaPorConfirmar).toEqual({ base: 2000, lineas: 1 });
    expect(summary.subtotal).toBe(2500);
    expect(summary.total).toBe(2500);
  });

  it('redondea mitad hacia arriba sin errores de coma flotante', () => {
    expect(vatHalfUp(50, 1)).toBe(1); // 0,5 → 1
    expect(vatHalfUp(10, 5)).toBe(1); // 0,5 → 1
    expect(vatHalfUp(9, 5)).toBe(0); // 0,45 → 0
    expect(vatHalfUp(150, 19)).toBe(29); // 28,5 → 29
  });

  it('rechaza cantidades y precios no enteros', () => {
    expect(() => summarizeCart([line(1, 100, 19, 0)])).toThrow(/Cantidad/);
    expect(() => summarizeCart([line(1, 10.5, 19, 1)])).toThrow(/Precio/);
  });

  it('detecta cuando la lista cambió respecto a la foto', () => {
    const snapshot = line(1, 1000, 0, 1).precio;

    expect(priceSnapshotChanged(snapshot, { precio: 1000, ivaPct: 0 })).toBe(
      false,
    );
    expect(priceSnapshotChanged(snapshot, { precio: 1000, ivaPct: null })).toBe(
      true,
    );
    expect(priceSnapshotChanged(snapshot, { precio: 1100, ivaPct: 0 })).toBe(
      true,
    );
    expect(priceSnapshotChanged(snapshot, null)).toBe(true);
  });
});
