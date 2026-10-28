-- Categorización: taxonomía (categoría → subcategoría → grupo) y asignación
-- producto → grupo en una tabla propia, independiente de `products`.
-- Ver docs/categorization.md.

-- Categorías y subcategorías: slug público, orden y visibilidad.
-- Las filas que ya existieran (el sync nunca las pobló) reciben un slug
-- provisional único; la carga de la taxonomía (`pnpm categorization seed`) crea
-- las definitivas por nombre.
ALTER TABLE "categories"
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
UPDATE "categories" SET "slug" = 'categoria-' || "id" WHERE "slug" IS NULL;
ALTER TABLE "categories" ALTER COLUMN "slug" SET NOT NULL;

ALTER TABLE "subcategories"
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
UPDATE "subcategories" SET "slug" = 'subcategoria-' || "id" WHERE "slug" IS NULL;
ALTER TABLE "subcategories" ALTER COLUMN "slug" SET NOT NULL;

-- Grupos de producto (tercer nivel).
CREATE TABLE "product_groups" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "subcategory_id" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_groups_pkey" PRIMARY KEY ("id")
);

-- Asignación producto → grupo, unida por `producto_key` (no por el id local).
CREATE TABLE "product_categorizations" (
    "id" SERIAL NOT NULL,
    "producto_key" TEXT NOT NULL,
    "category_id" INTEGER NOT NULL,
    "subcategory_id" INTEGER NOT NULL,
    "group_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "signature" TEXT NOT NULL,
    "classified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_categorizations_pkey" PRIMARY KEY ("id")
);

-- Reglas aprendidas para clasificar productos nuevos (solo locales).
CREATE TABLE "categorization_rules" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "group_id" INTEGER NOT NULL,
    "support" INTEGER NOT NULL,
    "purity" DECIMAL(5,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categorization_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");
CREATE UNIQUE INDEX "subcategories_slug_category_id_key" ON "subcategories"("slug", "category_id");
CREATE UNIQUE INDEX "product_groups_name_subcategory_id_key" ON "product_groups"("name", "subcategory_id");
CREATE UNIQUE INDEX "product_groups_slug_subcategory_id_key" ON "product_groups"("slug", "subcategory_id");
CREATE UNIQUE INDEX "product_categorizations_producto_key_key" ON "product_categorizations"("producto_key");
CREATE INDEX "product_categorizations_category_id_idx" ON "product_categorizations"("category_id");
CREATE INDEX "product_categorizations_subcategory_id_idx" ON "product_categorizations"("subcategory_id");
CREATE INDEX "product_categorizations_group_id_idx" ON "product_categorizations"("group_id");
CREATE INDEX "product_categorizations_needs_review_idx" ON "product_categorizations"("needs_review");
CREATE UNIQUE INDEX "categorization_rules_kind_rule_key_key" ON "categorization_rules"("kind", "rule_key");
CREATE INDEX "categorization_rules_group_id_idx" ON "categorization_rules"("group_id");

ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "subcategories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CASCADE: el sync desactiva productos, nunca los borra; solo una limpieza
-- manual de `products` arrastraría su asignación.
ALTER TABLE "product_categorizations" ADD CONSTRAINT "product_categorizations_producto_key_fkey" FOREIGN KEY ("producto_key") REFERENCES "products"("producto_key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_categorizations" ADD CONSTRAINT "product_categorizations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_categorizations" ADD CONSTRAINT "product_categorizations_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "subcategories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_categorizations" ADD CONSTRAINT "product_categorizations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "product_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "product_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
