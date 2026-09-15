import { ApiProperty } from '@nestjs/swagger';

/** Lista privada tal como la consume la UI. */
export class OrderListResponseDto {
  @ApiProperty({ example: 'clx123abc456' })
  id!: string;

  @ApiProperty({ example: 'Pedido de cafetería' })
  name!: string;

  @ApiProperty({ example: 12 })
  itemCount!: number;

  @ApiProperty({ example: '2026-09-15T12:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-09-15T12:15:00.000Z', format: 'date-time' })
  updatedAt!: string;
}

/** Respuesta de `GET /order-lists`. */
export class OrderListsMetaDto {
  @ApiProperty({ example: 2 })
  total!: number;

  @ApiProperty({ example: 10 })
  maxLists!: number;
}

export class OrderListsResponseDto {
  @ApiProperty({ type: [OrderListResponseDto] })
  data!: OrderListResponseDto[];

  @ApiProperty({ type: OrderListsMetaDto })
  meta!: OrderListsMetaDto;
}
