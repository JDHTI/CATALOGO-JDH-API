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

/**
 * Qué muestra la imagen. Espejo del enum `ProductImageKind` de Prisma; se
 * declara aquí para que el parser no dependa del cliente generado.
 */
export type ImageKind = 'principal' | 'detalle' | 'tabla_nutricional';

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
  /** Tipo declarado por la subcarpeta de entrega; `null` si no se clasificó. */
  kind?: ImageKind | null;
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
// Layout «carpeta de producto» (entregas tipo Unilever)
//
//   1.FRUCO 2000X2000 PX/                       ← carpeta de marca (se ignora)
//     1-1001-FRUCO TOMATE 4350 G/               ← consecutivo-REFERENCIA-nombre
//       1-1001-FRUCO TOMATE 4350 G.png          ← principal   (posición 0)
//       1B-1001-FRUCO TOMATE 4350 G.png         ← galería     (posición 1)
//       1C-1001-FRUCO TOMATE 4350 G.png         ← galería     (posición 2)
//
// La REFERENCIA la manda la carpeta (es el segmento del medio). El consecutivo
// es interno del proveedor y se descarta; en el bucket la carpeta del producto
// es `{referencia}-{nombre}` en slug.
// =============================================================================

/** `{consecutivo}-{referencia}-{nombre}` en el nombre de la carpeta. */
const PRODUCT_FOLDER = /^(\d+)-([^-\s]+)-(.+)$/;
/** `{consecutivo}{letra?}-{referencia}-{nombre}` en el nombre del archivo. */
const PRODUCT_FILE = /^(\d+)([A-Za-z]?)-([^-\s]+)-(.+)$/;

export interface ParsedProductFolder {
  /** Referencia del ERP (`Product.sku`), tomada del segmento del medio. */
  ref: string;
  /** Nombre del producto tal como lo entregó el proveedor, sin consecutivo. */
  productName: string;
  /** Carpeta del producto en el bucket: `{ref}-{nombre}` en slug. */
  objectFolder: string;
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
 * Lee `{consecutivo}-{referencia}-{nombre}` de una carpeta de producto.
 * Devuelve `null` si el nombre no sigue el layout (p. ej. la carpeta de
 * proveedor del layout plano), para que quien llama pueda caer al parser
 * por nombre de archivo.
 */
export function parseProductFolderName(
  folderName: string,
): ParsedProductFolder | null {
  const match = folderName.trim().match(PRODUCT_FOLDER);
  if (!match) return null;

  const ref = match[2].trim().toUpperCase();
  const productName = match[3].trim().replace(/\s+/g, ' ');
  const nameSlug = slug(productName);
  if (!ref || !nameSlug) return null;

  return {
    ref,
    productName,
    objectFolder: `${slug(ref)}-${nameSlug}`,
  };
}

/**
 * Posición de galería a partir del sufijo de letra del consecutivo: sin letra
 * (o `A`) es la principal, `B` la segunda, `C` la tercera, y así. Devuelve
 * `null` si el archivo no sigue el layout — sin letra no se puede deducir la
 * posición, y adivinar 0 sobreescribiría la imagen principal.
 */
export function parseGalleryPosition(filename: string): number | null {
  const basename = filename.replace(/\.[^.]+$/, '');
  const match = basename
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(WINDOWS_COPY_PAREN, '')
    .replace(WINDOWS_COPY_WORD, '')
    .trim()
    .match(PRODUCT_FILE);
  if (!match) return null;

  const letter = match[2].toUpperCase();
  return letter ? letter.charCodeAt(0) - 'A'.charCodeAt(0) : 0;
}

/**
 * Candidato derivado del layout por carpeta de producto: referencia de la
 * carpeta, posición de la letra del archivo. Devuelve `[]` si la carpeta o el
 * archivo no siguen el layout, para que el llamador caiga a
 * `parseImageFilename`.
 */
export function parseProductFolderCandidates(
  folderName: string,
  filename: string,
): ParsedFilenameCandidate[] {
  const folder = parseProductFolderName(folderName);
  if (!folder) return [];

  const position = parseGalleryPosition(filename);
  if (position === null) return [];

  return [
    {
      sku: folder.ref,
      position,
      isPrimary: position === 0,
      objectFolder: folder.objectFolder,
    },
  ];
}

// =============================================================================
// Clasificación por subcarpeta de tipo
//
//   64-19977-MAIZENA BUÑUELOS 300G/
//     p-producto/            → principal   (la primera es la primaria)
//     d-detalle/             → detalle
//     tn-tabla-nutricional/  → tabla nutricional
//
// El tipo NO se deduce del contenido ni de la letra del consecutivo: la letra
// solo indica orden de entrega y el mismo tipo cae en letras distintas según
// el producto. Lo declara quien prepara la entrega, y punto.
// =============================================================================

/** Prefijo de la subcarpeta → tipo. `tn` antes que `t` para que no se solapen. */
const KIND_PREFIXES: readonly (readonly [string, ImageKind])[] = [
  ['tn', 'tabla_nutricional'],
  ['p', 'principal'],
  ['d', 'detalle'],
];

/** Orden en que los tipos ocupan las posiciones de la galería. */
const KIND_ORDER: readonly ImageKind[] = [
  'principal',
  'detalle',
  'tabla_nutricional',
];

/**
 * Lee el tipo de una subcarpeta de entrega. Acepta el prefijo con o sin
 * sufijo descriptivo (`p`, `p-producto`, `tn-tabla-nutricional`) y devuelve
 * `null` si la carpeta no es de clasificación — que es lo que distingue una
 * subcarpeta de tipo de la carpeta de producto que la contiene.
 */
export function parseImageKindFolder(folderName: string): ImageKind | null {
  const normalized = folderName
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

  for (const [prefix, kind] of KIND_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(`${prefix}-`)) {
      return kind;
    }
  }
  return null;
}

/** Posición relativa del tipo; los sin clasificar van al final. */
export function kindRank(kind: ImageKind | null): number {
  if (kind === null) return KIND_ORDER.length;
  const index = KIND_ORDER.indexOf(kind);
  return index === -1 ? KIND_ORDER.length : index;
}

export interface ClassifiedFile {
  kind: ImageKind | null;
  filename: string;
}

/**
 * Asigna las posiciones de la galería de UN producto a partir del tipo.
 *
 * El orden es `principal` → `detalle` → `tabla_nutricional`, y dentro de cada
 * tipo por nombre de archivo. Así la posición 0 —la que el catálogo muestra
 * como miniatura— es siempre una foto del producto y nunca una tabla
 * nutricional, sin importar qué letra le haya puesto el proveedor.
 *
 * Devuelve las posiciones en el mismo orden que `files`.
 */
export function assignKindPositions(files: ClassifiedFile[]): number[] {
  // Dentro de un tipo se respeta la letra del consecutivo (base, B, C, D):
  // es el orden en que el proveedor entrega las tomas. `localeCompare` no
  // sirve aquí porque puede ordenar "64B-" antes de "64-".
  const ordered = files
    .map((file, index) => ({
      file,
      index,
      letter: parseGalleryPosition(file.filename) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort(
      (a, b) =>
        kindRank(a.file.kind) - kindRank(b.file.kind) ||
        a.letter - b.letter ||
        a.file.filename.localeCompare(b.file.filename, 'es'),
    );

  const positions = new Array<number>(files.length);
  ordered.forEach((entry, position) => {
    positions[entry.index] = position;
  });
  return positions;
}
