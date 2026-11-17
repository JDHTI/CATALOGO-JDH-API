-- Listas de precios externas al DWH (hoy: empleados JDH), en una tabla propia
-- que el sync de productos no toca. Ver docs/product-prices.md.
CREATE TABLE "product_list_prices" (
    "id" SERIAL NOT NULL,
    "list" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "producto_key" TEXT,
    "inventory_unit" TEXT,
    "price" DECIMAL(14,2) NOT NULL,
    "vat_pct" DECIMAL(5,2),
    "price_with_vat" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "generated_at" TIMESTAMP(3) NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "loaded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_list_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_list_prices_list_sku_key" ON "product_list_prices"("list", "sku");

CREATE INDEX "product_list_prices_list_producto_key_idx" ON "product_list_prices"("list", "producto_key");
