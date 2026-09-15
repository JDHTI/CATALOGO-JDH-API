import { ApiProperty } from '@nestjs/swagger';

import { ProductResponseDto } from '@modules/products/dto/product-response.dto';

/** Línea de lista con el producto completo para evitar N+1 en la UI. */
export class OrderListItemResponseDto {
  @ApiProperty({ example: 42 })
  productId!: number;

  @ApiProperty({ example: 3, minimum: 1 })
  quantity!: number;

  @ApiProperty({
    example: true,
    description: 'Indica si el producto sigue activo en el catálogo.',
  })
  productActive!: boolean;

  @ApiProperty({ type: ProductResponseDto })
  product!: ProductResponseDto;

  @ApiProperty({ example: '2026-09-15T12:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-09-15T12:00:00.000Z', format: 'date-time' })
  updatedAt!: string;
}

/** Respuesta paginada de `GET /order-lists/:id/items`. */
export class OrderListItemsResponseDto {
  @ApiProperty({ type: [OrderListItemResponseDto] })
  data!: OrderListItemResponseDto[];

  @ApiProperty({
    example: { page: 1, limit: 100, total: 12, totalPages: 1 },
  })
  meta!: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
