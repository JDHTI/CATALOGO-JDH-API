-- Editorial content is deliberately nullable: existing products can be
-- migrated progressively without blocking the DWH sync or public API.
ALTER TABLE "products"
  ADD COLUMN "long_description" TEXT,
  ADD COLUMN "seo_title" TEXT,
  ADD COLUMN "seo_description" TEXT;
