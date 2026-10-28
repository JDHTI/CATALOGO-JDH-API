import { join } from 'node:path';

import {
  CATEGORIZATION_DATA_DIR,
  loadAssignments,
  loadTaxonomy,
  parseAssignmentsCsv,
} from './categorization.data';

describe('parseAssignmentsCsv', () => {
  it('parsea filas válidas e interpreta la confianza', () => {
    const rows = parseAssignmentsCsv(
      'producto_key,grupo,confianza\nabc,G001,A\ndef,G002,M\nghi,G003,B\n',
    );

    expect(rows).toEqual([
      { productoKey: 'abc', groupCode: 'G001', confidence: 'alta' },
      { productoKey: 'def', groupCode: 'G002', confidence: 'media' },
      { productoKey: 'ghi', groupCode: 'G003', confidence: 'baja' },
    ]);
  });

  it('tolera CRLF y líneas vacías', () => {
    const rows = parseAssignmentsCsv('h,h,h\r\nabc,G001,A\r\n\r\n');

    expect(rows).toHaveLength(1);
  });

  it('falla con el número de línea si una fila está mal (no se salta en silencio)', () => {
    expect(() =>
      parseAssignmentsCsv('h,h,h\nabc,G001,A\nsin-grupo,,A\n'),
    ).toThrow(/línea 3/);
    expect(() => parseAssignmentsCsv('h,h,h\nabc,G001,Z\n')).toThrow(/línea 2/);
  });
});

describe('datos de la carga inicial (data/categorizacion)', () => {
  // Estos archivos son los que `categorization bootstrap` carga: si se editan
  // a mano y se descuadran, la carga fallaría o dejaría productos sin ubicar.
  const taxonomy = loadTaxonomy(
    join(CATEGORIZATION_DATA_DIR, 'taxonomia.json'),
  );
  const assignments = loadAssignments(
    join(CATEGORIZATION_DATA_DIR, 'asignaciones-v3.csv'),
  );
  const groups = taxonomy.categories.flatMap((category) =>
    category.subcategories.flatMap((sub) => sub.groups),
  );

  it('los códigos de grupo son únicos', () => {
    expect(new Set(groups.map((g) => g.code)).size).toBe(groups.length);
  });

  it('no repite nombres dentro de la misma categoría ni subcategoría', () => {
    const categoryNames = taxonomy.categories.map((c) => c.name);
    expect(new Set(categoryNames).size).toBe(categoryNames.length);

    for (const category of taxonomy.categories) {
      const subNames = category.subcategories.map((s) => s.name);
      expect(new Set(subNames).size).toBe(subNames.length);
      for (const sub of category.subcategories) {
        const groupNames = sub.groups.map((g) => g.name);
        expect(new Set(groupNames).size).toBe(groupNames.length);
      }
    }
  });

  it('toda asignación apunta a un grupo que existe en la taxonomía', () => {
    const codes = new Set(groups.map((g) => g.code));
    const unknown = assignments.filter((row) => !codes.has(row.groupCode));

    expect(unknown).toEqual([]);
  });

  it('cada producto aparece una sola vez', () => {
    const keys = new Set(assignments.map((row) => row.productoKey));

    expect(keys.size).toBe(assignments.length);
  });

  it('Servicios existe y no es visible en la navegación pública', () => {
    const services = taxonomy.categories.find((c) => c.name === 'Servicios');

    expect(services?.active).toBe(false);
    expect(services?.subcategories[0].name).toBe('Servicios');
    expect(services?.subcategories[0].groups[0].name).toBe('Servicios');
  });
});
