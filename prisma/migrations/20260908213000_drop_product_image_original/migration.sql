-- La ingesta ya no guarda el archivo original en `originals/`: se procesa el
-- buffer en memoria y solo se suben las tres variantes WebP. La columna queda
-- sin quien la escriba, así que se elimina.
--
-- Los objetos que ya están en `originals/` dentro del bucket NO se tocan acá;
-- borrarlos es una decisión aparte.
ALTER TABLE "product_images" DROP COLUMN "original_object_key";
