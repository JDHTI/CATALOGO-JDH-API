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
  /**
   * Carpeta a usar en la key del bucket. Si no viene, se usa el propio `sku`
   * (layout plano histórico). El layout por carpeta de producto la rellena
   * con `{referencia}-{nombre-del-producto}` en slug.
   */
  objectFolder?: string;
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

// =============================================================================
// Layout «carpeta de producto». Conviven DOS órdenes en las entregas:
//
//   (a) consecutivo primero — entregas tipo Unilever
//
//   1.FRUCO 2000X2000 PX/                       ← carpeta de marca (se ignora)
//     1-1001-FRUCO TOMATE 4350 G/               ← consecutivo-REFERENCIA-nombre
//       1-1001-FRUCO TOMATE 4350 G.png          ← principal   (posición 0)
//       1B-1001-FRUCO TOMATE 4350 G.png         ← galería     (posición 1)
//       1C-1001-FRUCO TOMATE 4350 G.png         ← galería     (posición 2)
//
//   (b) referencia primero — el nombre del producto es OPCIONAL
//
//     0212-01/                                  ← REFERENCIA-consecutivo
//       0212-01.png                             ← principal   (posición 0)
//       0212-01B.png                            ← galería     (posición 1)
//     1001-1-FRUCO TOMATE 4350 G/               ← REFERENCIA-consecutivo-nombre
//       1001-1B-FRUCO TOMATE 4350 G.png         ← galería     (posición 1)
//
// En los dos la REFERENCIA la manda la carpeta y el consecutivo es interno del
// proveedor, así que se descarta. En el bucket la carpeta del producto es
// `{referencia}-{nombre}` en slug, o solo `{referencia}` cuando la entrega no
// trae nombre.
//
// Los dos órdenes son estructuralmente simétricos: `1-1001-NOMBRE` encaja en
// (a) con ref 1001 y en (b) con ref 1, y no hay forma de distinguirlos por la
// forma del nombre. Por eso NO se elige un orden — se emiten los dos como
// candidatos y gana el que exista en la base, igual que hace
// `parseImageFilename`. Se prueba primero la referencia más larga: un
// consecutivo es un contador corto y una referencia es un código del ERP.
// =============================================================================

/** Orden de los segmentos en el nombre de la carpeta. */
export type FolderLayout = 'consecutivo-primero' | 'referencia-primero';

/** (a) `{consecutivo}-{referencia}-{nombre}` en la carpeta. */
const FOLDER_SEQUENCE_FIRST = /^(\d+)-([^-\s]+)-(.+)$/;
/** (a) `{consecutivo}{letra?}-{referencia}-{nombre}` en el archivo. */
const FILE_SEQUENCE_FIRST = /^(\d+)([A-Za-z]?)-([^-\s]+)-(.+)$/;

/** (b) `{referencia}-{consecutivo}` en la carpeta, con `-{nombre}` opcional. */
const FOLDER_REFERENCE_FIRST = /^([^-\s]+)-(\d+)(?:-(.+))?$/;
/** (b) `{referencia}-{consecutivo}{letra?}` en el archivo, `-{nombre}` opcional. */
const FILE_REFERENCE_FIRST = /^([^-\s]+)-(\d+)([A-Za-z]?)(?:-(.+))?$/;

export interface ParsedProductFolder {
  /** Referencia del ERP (`Product.sku`), sin el consecutivo del proveedor. */
  ref: string;
  /** Nombre del producto tal como lo entregó el proveedor, `''` si no viene. */
  productName: string;
  /** Carpeta del producto en el bucket: `{ref}-{nombre}` (o `{ref}`) en slug. */
  objectFolder: string;
  /** Orden del que salió esta lectura; define cómo leer el archivo. */
  layout: FolderLayout;
}

/** Slug estable para la key del bucket: sin acentos, sin símbolos, minúsculas. */
function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Arma una lectura a partir de los segmentos ya separados. `requireName` es
 * true para el orden (a), donde el nombre es obligatorio: sin él la carpeta
 * sería `{referencia}-{consecutivo}` y le corresponde el orden (b).
 */
function buildFolder(
  rawRef: string,
  rawName: string,
  layout: FolderLayout,
  requireName: boolean,
): ParsedProductFolder | null {
  const ref = rawRef.trim().toUpperCase();
  const refSlug = slug(ref);
  if (!ref || !refSlug) return null;

  const productName = rawName.trim().replace(/\s+/g, ' ');
  const nameSlug = slug(productName);
  if (requireName && !nameSlug) return null;

  return {
    ref,
    productName,
    objectFolder: nameSlug ? `${refSlug}-${nameSlug}` : refSlug,
    layout,
  };
}

/**
 * Lecturas posibles de una carpeta de producto, ordenadas por prioridad
 * (referencia más larga primero). Devuelve `[]` si el nombre no sigue ninguno
 * de los dos órdenes (p. ej. la carpeta de marca o la de proveedor del layout
 * plano), para que quien llama pueda caer al parser por nombre de archivo.
 */
export function parseProductFolderName(
  folderName: string,
): ParsedProductFolder[] {
  const trimmed = folderName.trim();
  const readings: ParsedProductFolder[] = [];

  const sequenceFirst = trimmed.match(FOLDER_SEQUENCE_FIRST);
  if (sequenceFirst) {
    const folder = buildFolder(
      sequenceFirst[2],
      sequenceFirst[3],
      'consecutivo-primero',
      true,
    );
    if (folder) readings.push(folder);
  }

  const referenceFirst = trimmed.match(FOLDER_REFERENCE_FIRST);
  if (referenceFirst) {
    const folder = buildFolder(
      referenceFirst[1],
      referenceFirst[3] ?? '',
      'referencia-primero',
      false,
    );
    if (folder) readings.push(folder);
  }

  // Solo decide el ORDEN de prueba contra la base; si la primera referencia no
  // existe se cae a la siguiente. `sort` es estable, así que a igual longitud
  // gana el orden (a), que es el histórico.
  return readings.sort((a, b) => b.ref.length - a.ref.length);
}

/**
 * Posición de galería a partir del sufijo de letra del consecutivo: sin letra
 * (o `A`) es la principal, `B` la segunda, `C` la tercera, y así. `layout`
 * dice dónde vive el consecutivo dentro del nombre. Devuelve `null` si el
 * archivo no sigue ese orden — sin letra no se puede deducir la posición, y
 * adivinar 0 sobreescribiría la imagen principal.
 */
export function parseGalleryPosition(
  filename: string,
  layout: FolderLayout = 'consecutivo-primero',
): number | null {
  const basename = filename
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(WINDOWS_COPY_PAREN, '')
    .replace(WINDOWS_COPY_WORD, '')
    .trim();

  const sequenceFirst = layout === 'consecutivo-primero';
  const match = basename.match(
    sequenceFirst ? FILE_SEQUENCE_FIRST : FILE_REFERENCE_FIRST,
  );
  if (!match) return null;

  const letter = (sequenceFirst ? match[2] : match[3]).toUpperCase();
  return letter ? letter.charCodeAt(0) - 'A'.charCodeAt(0) : 0;
}

// =============================================================================
// Layout «carpeta = referencia, posición por orden»
//
//   18271/                                  ← la carpeta ES la referencia
//     Hero_Image_30243107_ESP-01.png        ← principal   (posición 0)
//     Hero_Image_30243107_ESP-06.png        ← galería     (posición 1)
//
// Acá el nombre del archivo no aporta nada: lo pone el proveedor y sus sufijos
// (`-01`, `-06`, `_S04`) no son posiciones. Lo único que ordena la galería es
// la posición del archivo dentro de la carpeta, así que la calcula quien lista
// el directorio y la pasa como `orderIndex`.
// =============================================================================

/**
 * Orden natural de los archivos de una carpeta de referencia: comparación
 * numérica, para que `S2` vaya antes que `S10` y no al revés.
 */
export function compareDeliveryFilenames(a: string, b: string): number {
  return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
}

/**
 * Candidato del layout más simple: la carpeta es la referencia y la posición
 * sale del orden del archivo dentro de ella.
 *
 * Es el ÚLTIMO recurso a propósito. Se prueba después de los layouts con
 * consecutivo y del nombre de archivo, así que solo gana cuando ninguno de
 * esos resolvió un producto: una entrega que ya funcionaba conserva sus
 * posiciones en vez de renumerarse por el orden del directorio.
 */
export function parseReferenceFolderCandidate(
  folderName: string,
  orderIndex: number,
): ParsedFilenameCandidate[] {
  const ref = folderName.trim().toUpperCase();
  const refSlug = slug(ref);
  if (!refSlug) return [];
  if (!Number.isInteger(orderIndex) || orderIndex < 0) return [];

  return [
    {
      sku: ref,
      position: orderIndex,
      isPrimary: orderIndex === 0,
      objectFolder: refSlug,
    },
  ];
}

/**
 * Candidatos derivados del layout por carpeta de producto: referencia de la
 * carpeta, posición de la letra del archivo, uno por cada lectura de la
 * carpeta que el archivo confirme. Devuelve `[]` si ni la carpeta ni el
 * archivo siguen el layout, para que el llamador caiga a `parseImageFilename`.
 */
export function parseProductFolderCandidates(
  folderName: string,
  filename: string,
): ParsedFilenameCandidate[] {
  const candidates: ParsedFilenameCandidate[] = [];

  for (const folder of parseProductFolderName(folderName)) {
    const position = parseGalleryPosition(filename, folder.layout);
    if (position === null) continue;

    candidates.push({
      sku: folder.ref,
      position,
      isPrimary: position === 0,
      objectFolder: folder.objectFolder,
    });
  }

  return candidates;
}
