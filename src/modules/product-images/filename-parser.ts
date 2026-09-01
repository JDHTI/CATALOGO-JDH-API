/**
 * Lectura de nombres de archivo entregados por proveedores.
 *
 * El formato exacto de entrega NO está estandarizado (puede llegar `SKU.png`,
 * `SKU-2.png`, `SKU_2.png`, con sufijos de copia de Windows, etc.), así que
 * este parser es deliberadamente TOLERANTE: no decide un único SKU, devuelve
 * candidatos ordenados por prioridad. Quien llama (`ProductImagesService`)
 * intenta el primer candidato contra la base de datos y solo cae al
 * siguiente si no encuentra producto — así un SKU real como "REF-5" nunca se
 * rompe por parecer "REF" + posición 5, salvo que "REF-5" no exista.
 */

export interface ParsedFilenameCandidate {
  sku: string;
  position: number;
  isPrimary: boolean;
}

// Sufijo de copia de Windows: "(1)", " (2)".
const WINDOWS_COPY_PAREN = /\s*\(\d+\)$/;
// Sufijo de copia en español: "- copia", "-copia (2)".
const WINDOWS_COPY_WORD = /[-_ ]+copia(\s*\(\d+\))?$/i;
// Sufijo de posición de galería: "-2", "_2", " 2" al final, máximo 2 dígitos.
const GALLERY_SUFFIX = /[-_ ]+(\d{1,2})$/;

function normalizeBasename(filename: string): string {
  const withoutExtension = filename.replace(/\.[^.]+$/, '');

  return withoutExtension
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(WINDOWS_COPY_PAREN, '')
    .replace(WINDOWS_COPY_WORD, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/**
 * Deriva candidatos de SKU + posición a partir de un nombre de archivo.
 * Devuelve `[]` si no queda nada aprovechable (p. ej. el archivo era solo
 * una extensión o símbolos).
 */
export function parseImageFilename(
  filename: string,
): ParsedFilenameCandidate[] {
  const normalized = normalizeBasename(filename);
  if (!normalized) return [];

  const candidates: ParsedFilenameCandidate[] = [
    { sku: normalized, position: 0, isPrimary: true },
  ];

  const gallerySuffix = normalized.match(GALLERY_SUFFIX);
  if (gallerySuffix?.index !== undefined) {
    const position = Number(gallerySuffix[1]);
    const sku = normalized.slice(0, gallerySuffix.index).trim();
    if (sku.length > 0) {
      candidates.push({ sku, position, isPrimary: position === 1 });
    }
  }

  return candidates;
}
