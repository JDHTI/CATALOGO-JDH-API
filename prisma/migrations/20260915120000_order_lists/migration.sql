-- CreateTable
CREATE TABLE "order_lists" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_list_items" (
    "order_list_id" TEXT NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_list_items_pkey" PRIMARY KEY ("order_list_id", "product_id")
);

-- CreateIndex
CREATE INDEX "order_lists_user_id_updated_at_idx" ON "order_lists"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "order_list_items_product_id_idx" ON "order_list_items"("product_id");

-- AddForeignKey
ALTER TABLE "order_list_items" ADD CONSTRAINT "order_list_items_order_list_id_fkey" FOREIGN KEY ("order_list_id") REFERENCES "order_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_list_items" ADD CONSTRAINT "order_list_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
