import { parsePriceList, vatLabelFor } from './price-list.file';

const base = {
  list: 'empleados-jdh',
  currency: 'COP',
  generated_at: '2026-11-17T18:30:42.633936+00:00',
  snapshot_date: '2026-11-17',
};

const item = (overrides: Record<string, unknown> = {}) => ({
  sku: '1000',
  description: 'Partes Para Rueda',
  inventory_unit: 'UNIDAD',
  price: '49863',
  vat_pct: '19',
  vat_label: 'IVA 19 %',
  price_with_vat: '59337',
  ...overrides,
});

describe('parsePriceList', () => {
  it('valida y normaliza un archivo correcto', () => {
    const file = parsePriceList({
      ...base,
      total: 2,
      items: [
        item(),
        item({
          sku: '1001',
          vat_pct: null,
          vat_label: null,
          price_with_vat: '049863',
        }),
      ],
    });

    expect(file.list).toBe('empleados-jdh');
    expect(file.snapshotDate).toBe('2026-11-17');
    expect(file.generatedAt.toISOString()).toBe('2026-11-17T18:30:42.633Z');
    expect(file.items).toEqual([
      {
        sku: '1000',
        inventoryUnit: 'UNIDAD',
        price: '49863',
        vatPct: '19',
        vatLabel: 'IVA 19 %',
        priceWithVat: '59337',
      },
      {
        sku: '1001',
        inventoryUnit: 'UNIDAD',
        price: '49863',
        vatPct: null,
        vatLabel: null,
        priceWithVat: '49863',
      },
    ]);
  });

  it('no guarda campos que no son del contrato (costo, margen)', () => {
    const file = parsePriceList({
      ...base,
      items: [item({ cost: '43381', margin_employee: '13' })],
    });

    expect(Object.keys(file.items[0])).not.toEqual(
      expect.arrayContaining(['cost', 'margin_employee']),
    );
  });

  it('rechaza un archivo truncado (total ≠ items)', () => {
    expect(() =>
      parsePriceList({ ...base, total: 3, items: [item()] }),
    ).toThrow(/truncado/);
  });

  it('rechaza SKUs repetidos e importes no decimales, todos a la vez', () => {
    expect(() =>
      parsePriceList({
        ...base,
        items: [
          item(),
          item(),
          item({ sku: '2', price: '12,5' }),
          item({ sku: '3', price: -1 }),
        ],
      }),
    ).toThrow(/SKU repetido.*sku 2.*"price".*sku 3.*"price"/);
  });

  it('rechaza cabeceras inválidas', () => {
    expect(() =>
      parsePriceList({ ...base, snapshot_date: '17/11/2026', items: [] }),
    ).toThrow(/snapshot_date/);
    expect(() => parsePriceList({ ...base })).toThrow(/items/);
  });
});
describe('IVA 0 frente a IVA desconocido', () => {
  it('conserva vat_pct 0 como "0", distinto de null', () => {
    const file = parsePriceList({
      ...base,
      items: [
        item({
          sku: 'A',
          price: '7816',
          vat_pct: '0',
          vat_label: 'Sin IVA',
          price_with_vat: '7816',
        }),
        item({ sku: 'B', vat_pct: 0, price_with_vat: '49863' }),
        item({
          sku: 'C',
          vat_pct: null,
          vat_label: null,
          price_with_vat: '49863',
        }),
      ],
    });

    expect(file.items.map((i) => i.vatPct)).toEqual(['0', '0', null]);
    expect(file.items[0].vatLabel).toBe('Sin IVA');
  });

  it('rechaza IVA desconocido con precio con IVA distinto del precio', () => {
    expect(() =>
      parsePriceList({ ...base, items: [item({ vat_pct: null })] }),
    ).toThrow(/debe ser igual/);
  });

  it('rechaza vat_pct ausente (no es lo mismo que null)', () => {
    expect(() =>
      parsePriceList({ ...base, items: [item({ vat_pct: undefined })] }),
    ).toThrow(/vat_pct/);
  });

  it('deriva la etiqueta: 0 Sin IVA, null por confirmar', () => {
    expect(vatLabelFor(0)).toBe('Sin IVA');
    expect(vatLabelFor(null)).toBe('IVA por confirmar');
    expect(vatLabelFor(19)).toBe('IVA 19 %');
  });
});
