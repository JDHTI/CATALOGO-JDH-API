import { LogosService } from '@modules/logos/logos.service';

/**
 * Política de `Brand.slug`, sin dependencias de BD para probarla aislada.
 * Ver docs/brands.md.
 *
 * - Base: `LogosService.slug(nombre)`, la misma normalización de
 *   `logos:upload` y `brands:ingest`, así el nombre del archivo del logo
 *   coincide con la marca. Un nombre sin letras ni dígitos cae a `marca`.
 * - Colisión (dos nombres con la misma base): la marca que ya tenía la base
 *   la conserva y la otra recibe `{base}-{id}`. Determinista y estable: un
 *   slug asignado no cambia mientras no cambie el nombre de su marca.
 */

export const BRAND_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface BrandSlugInput {
  id: number;
  name: string;
}

export function brandSlugBase(name: string): string {
  return LogosService.slug(name) || 'marca';
}

/** Si `slug` es uno de los que la política admite para esa marca. */
export function isBrandSlugFor(slug: string, brand: BrandSlugInput): boolean {
  const base = brandSlugBase(brand.name);
  return (
    slug === base || new RegExp(`^${base}-${brand.id}(-\\d+)?$`).test(slug)
  );
}

/** Primer slug libre para la marca según la política. */
export function allocateBrandSlug(
  brand: BrandSlugInput,
  taken: ReadonlySet<string>,
): string {
  const base = brandSlugBase(brand.name);
  if (!taken.has(base)) return base;

  // `{base}-{id}` solo choca si otra marca se llama literalmente así
  // ("ACME 7" frente a la marca 7 "Acme."); se desempata con un contador.
  let candidate = `${base}-${brand.id}`;
  for (let n = 2; taken.has(candidate); n++) {
    candidate = `${base}-${brand.id}-${n}`;
  }
  return candidate;
}

/**
 * Slugs que hay que corregir: conserva todos los válidos y reasigna, por id
 * ascendente, los que no corresponden a su nombre (marca renombrada, fila
 * nueva o backfill de la migración que no coincidió con la normalización JS).
 */
export function planBrandSlugs(
  brands: (BrandSlugInput & { slug: string })[],
): { id: number; slug: string }[] {
  const invalid = brands
    .filter((brand) => !isBrandSlugFor(brand.slug, brand))
    .sort((a, b) => a.id - b.id);
  const taken = new Set(
    brands
      .filter((brand) => isBrandSlugFor(brand.slug, brand))
      .map((brand) => brand.slug),
  );

  return invalid.map((brand) => {
    const slug = allocateBrandSlug(brand, taken);
    taken.add(slug);
    return { id: brand.id, slug };
  });
}
