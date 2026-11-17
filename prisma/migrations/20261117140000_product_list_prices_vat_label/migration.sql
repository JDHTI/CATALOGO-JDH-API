-- Etiqueta de IVA de la fuente ("IVA 19 %", "IVA 5 %", "Sin IVA").
-- `vat_pct` = 0 (sin IVA) y `vat_pct` NULL (tasa desconocida) son distintos.
ALTER TABLE "product_list_prices" ADD COLUMN "vat_label" TEXT;
