-- Ejecutar antes de abrir tráfico, o en una ventana de mantenimiento:
-- CREATE INDEX bloquea escrituras mientras construye cada índice.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "products_active_name_id_idx" ON "products"("active", "name", "id");
CREATE INDEX "products_supplier_id_active_name_id_idx" ON "products"("supplier_id", "active", "name", "id");
CREATE INDEX "products_brand_id_active_name_id_idx" ON "products"("brand_id", "active", "name", "id");
CREATE INDEX "products_name_trgm_idx" ON "products" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "products_sku_trgm_idx" ON "products" USING GIN ("sku" gin_trgm_ops);
CREATE INDEX "brands_name_trgm_idx" ON "brands" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "product_images_is_primary_product_id_idx" ON "product_images"("is_primary", "product_id");
CREATE INDEX "favorites_user_id_created_at_id_idx" ON "favorites"("user_id", "created_at", "id");
CREATE INDEX "favorites_product_id_idx" ON "favorites"("product_id");
CREATE INDEX "order_list_items_order_list_id_created_at_product_id_idx" ON "order_list_items"("order_list_id", "created_at", "product_id");
