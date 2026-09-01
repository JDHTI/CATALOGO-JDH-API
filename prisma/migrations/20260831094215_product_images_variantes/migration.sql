-- AlterTable
ALTER TABLE "product_images" ADD COLUMN     "bytes" INTEGER,
ADD COLUMN     "card_url" TEXT NOT NULL,
ADD COLUMN     "full_url" TEXT NOT NULL,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "original_object_key" TEXT NOT NULL,
ADD COLUMN     "source_checksum" TEXT NOT NULL,
ADD COLUMN     "source_filename" TEXT,
ADD COLUMN     "thumb_url" TEXT NOT NULL,
ADD COLUMN     "width" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "product_images_product_id_position_key" ON "product_images"("product_id", "position");
