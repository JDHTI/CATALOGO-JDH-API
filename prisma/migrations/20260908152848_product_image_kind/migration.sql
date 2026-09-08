-- CreateEnum
CREATE TYPE "product_image_kind" AS ENUM ('principal', 'detalle', 'tabla_nutricional');

-- AlterTable
ALTER TABLE "product_images" ADD COLUMN     "kind" "product_image_kind";
