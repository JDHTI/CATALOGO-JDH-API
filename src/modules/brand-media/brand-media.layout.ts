import { extname, parse } from 'node:path';

import { LogosService } from '@modules/logos/logos.service';

/**
 * Contrato de la sección `brands/` del bucket: cómo se llama cada logo, cómo
 * se nombra el objeto y cómo se arma el manifiesto público. Sin dependencias
 * de S3 para poder probarlo aislado. Ver docs/brand-media.md.
 *
 * Las marcas se identifican por el nombre del archivo. El cruce con la tabla
 * de marcas es solo informativo: si el slug coincide con un `Brand.slug`, la
 * entrada lleva `marca` para que el frontend la enlace.
 */

export const BRAND_MEDIA_PREFIX = 'brands/';
export const BRAND_MANIFEST_KEY = 'brands/manifest.json';

export const BRAND_LOGO_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.tif',
  '.tiff',
  '.avif',
]);

export function isLogoFile(filename: string): boolean {
  return BRAND_LOGO_EXTENSIONS.has(extname(filename).toLowerCase());
}

/**
 * Slug de la marca a partir del nombre del archivo (`agricola_himalaya.png`
 * → `agricola-himalaya`). Es la clave estable del manifiesto: renombrar el
 * archivo es cambiar de marca.
 */
export function brandSlugFromFilename(filename: string): string {
  return LogosService.slug(parse(filename).name);
}

/**
 * Key del logo. Lleva el hash del contenido: si la imagen cambia, cambia la
 * URL, así que se sirve como `immutable`. El manifiesto es la única
 * indirección con caché corta.
 */
export function brandLogoKey(slug: string, hash8: string): string {
  return `${BRAND_MEDIA_PREFIX}${slug}/logo-${hash8}.webp`;
}

const LOGO_KEY = /^brands\/([a-z0-9-]+)\/logo-[0-9a-f]{8}\.webp$/;

/** Slug de la marca dueña de la key, o `null` si no es un logo (incluido el manifiesto). */
export function parseBrandLogoKey(key: string): string | null {
  return LOGO_KEY.exec(key)?.[1] ?? null;
}

/** Marca del catálogo (con productos activos) que corresponde al logo. */
export interface BrandManifestMarca {
  id: number;
  slug: string;
  nombre: string;
}

export interface BrandManifestEntry {
  slug: string;
  logo: string;
  /** Ausente si el slug no coincide con ninguna marca con productos activos. */
  marca?: BrandManifestMarca;
}

export interface BrandManifest {
  version: 1;
  generadoEn: string;
  marcas: BrandManifestEntry[];
}

export interface BucketObject {
  key: string;
  lastModified?: Date;
}

/**
 * Arma el manifiesto a partir de lo que HAY en el bucket, no de la última
 * entrega: así cargar 20 logos nuevos no exige reenviar los anteriores.
 *
 * Si quedaran dos logos para la misma marca (una carga interrumpida antes de
 * borrar el anterior), gana el más reciente.
 *
 * `catalog` son las marcas enlazables por slug.
 */
export function buildBrandManifest(
  objects: BucketObject[],
  publicUrl: (key: string) => string,
  generadoEn: Date,
  catalog: ReadonlyMap<string, BrandManifestMarca> = new Map(),
): BrandManifest {
  const newest = new Map<string, BucketObject>();
  for (const object of objects) {
    const slug = parseBrandLogoKey(object.key);
    if (!slug) continue;
    const current = newest.get(slug);
    const time = object.lastModified?.getTime() ?? 0;
    if (!current || time >= (current.lastModified?.getTime() ?? 0)) {
      newest.set(slug, object);
    }
  }

  const marcas = [...newest.entries()]
    .map(([slug, object]): BrandManifestEntry => {
      const marca = catalog.get(slug);
      return {
        slug,
        logo: publicUrl(object.key),
        ...(marca && { marca }),
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return { version: 1, generadoEn: generadoEn.toISOString(), marcas };
}

/**
 * Para el reporte de logos sin marca: slug del catálogo que solo difiere en
 * los guiones (`nescafe-dolcegusto` → `nescafe-dolce-gusto`), si lo hay.
 */
export function suggestCatalogSlug(
  slug: string,
  catalogSlugs: Iterable<string>,
): string | undefined {
  const compact = slug.replace(/-/g, '');
  for (const candidate of catalogSlugs) {
    if (candidate.replace(/-/g, '') === compact) return candidate;
  }
  return undefined;
}
