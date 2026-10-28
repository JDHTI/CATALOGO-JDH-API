import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Confidence } from './categorization.classifier';

/** Directorio con la taxonomía y las asignaciones de la carga inicial. */
export const CATEGORIZATION_DATA_DIR = join(
  process.cwd(),
  'data',
  'categorizacion',
);

export interface TaxonomyGroup {
  /** Código estable que usan los archivos de asignaciones (no se guarda en BD). */
  code: string;
  name: string;
  sortOrder: number;
}

export interface TaxonomySubcategory {
  name: string;
  sortOrder: number;
  groups: TaxonomyGroup[];
}

export interface TaxonomyCategory {
  name: string;
  sortOrder: number;
  /** `false`: no aparece en la navegación pública. */
  active: boolean;
  subcategories: TaxonomySubcategory[];
}

export interface Taxonomy {
  version: string;
  categories: TaxonomyCategory[];
}

/** Una fila de `asignaciones-*.csv`: producto → código de grupo. */
export interface AssignmentRow {
  productoKey: string;
  groupCode: string;
  confidence: Confidence;
}

const CONFIDENCE_BY_LETTER: Record<string, Confidence> = {
  A: 'alta',
  M: 'media',
  B: 'baja',
};

export function loadTaxonomy(path: string): Taxonomy {
  return JSON.parse(readFileSync(path, 'utf8')) as Taxonomy;
}

/**
 * Parsea `producto_key,grupo,confianza` (una línea de encabezado). Falla con
 * el número de línea si una fila viene mal: es una carga única y revisada, y
 * saltarse filas en silencio dejaría productos sin categoría sin avisar.
 */
export function parseAssignmentsCsv(text: string): AssignmentRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const rows: AssignmentRow[] = [];

  for (let index = 1; index < lines.length; index++) {
    const [productoKey, groupCode, letter] = lines[index].split(',');
    const confidence = CONFIDENCE_BY_LETTER[letter?.trim()];
    if (!productoKey || !groupCode || !confidence) {
      throw new Error(
        `Asignación inválida en la línea ${index + 1}: "${lines[index]}"`,
      );
    }
    rows.push({
      productoKey: productoKey.trim(),
      groupCode: groupCode.trim(),
      confidence,
    });
  }

  return rows;
}

export function loadAssignments(path: string): AssignmentRow[] {
  return parseAssignmentsCsv(readFileSync(path, 'utf8'));
}
