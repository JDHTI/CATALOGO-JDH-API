import { extname, parse } from 'node:path';

import { LogosService } from '@modules/logos/logos.service';

/**
 * Contrato de la sección `brands/` del bucket: cómo se llama cada logo, cómo
 * se nombra el objeto y cómo se arma el manifiesto público. Sin dependencias
 * de S3 para poder probarlo aislado. Ver docs/brand-media.md.
 *
 * Las marcas se identifican SOLO por el nombre del archivo: no hay cruce con
 * proveedores ni con la tabla de marcas del catálogo.
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

export interface BrandManifestEntry {
  slug: string;
  logo: string;
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
 */
export function buildBrandManifest(
  objects: BucketObject[],
  publicUrl: (key: string) => string,
  generadoEn: Date,
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
    .map(([slug, object]) => ({ slug, logo: publicUrl(object.key) }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return { version: 1, generadoEn: generadoEn.toISOString(), marcas };
}
