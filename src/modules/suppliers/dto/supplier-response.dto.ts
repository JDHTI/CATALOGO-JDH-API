import { ApiProperty } from '@nestjs/swagger';

/** Proveedor tal como lo consume la UI del catálogo. */
export class SupplierResponseDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'DISTRIBUIDORA ACME' })
  nombre!: string;

  @ApiProperty({
    example: 42,
    description: 'Cantidad de productos activos del proveedor',
  })
  totalProductos!: number;
}
