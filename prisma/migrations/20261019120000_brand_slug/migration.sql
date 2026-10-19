-- Brand.slug: identificador público para /marcas/{slug}. Ver docs/brands.md.
ALTER TABLE "brands" ADD COLUMN "slug" TEXT;

-- Backfill con la misma normalización que LogosService.slug (quitar acentos,
-- minúsculas, todo lo que no sea [a-z0-9] → '-', sin guiones en los bordes).
-- translate() cubre los acentos del castellano sin depender de `unaccent`; si
-- algún nombre raro no coincidiera con la versión JS, el sync lo corrige en su
-- siguiente corrida (ProductsSyncService.reconcileBrandSlugs).
-- Colisión: la marca de menor id se queda la base, el resto `{base}-{id}`.
WITH base AS (
  SELECT
    id,
    COALESCE(
      NULLIF(
        regexp_replace(
          regexp_replace(
            lower(translate(
              name,
              'ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÝÑÇáàâäãåéèêëíìîïóòôöõúùûüýÿñç',
              'AAAAAAEEEEIIIIOOOOOUUUUYNCaaaaaaeeeeiiiiooooouuuuyync'
            )),
            '[^a-z0-9]+', '-', 'g'
          ),
          '^-+|-+$', '', 'g'
        ),
        ''
      ),
      'marca'
    ) AS slug
  FROM "brands"
),
ranked AS (
  SELECT id, slug, row_number() OVER (PARTITION BY slug ORDER BY id) AS rn
  FROM base
)
UPDATE "brands" b
SET "slug" = CASE WHEN r.rn = 1 THEN r.slug ELSE r.slug || '-' || r.id END
FROM ranked r
WHERE b.id = r.id;

ALTER TABLE "brands" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");
