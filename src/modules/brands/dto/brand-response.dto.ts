import { ApiProperty } from '@nestjs/swagger';

/** Marca tal como la consume la UI del catálogo. */
export class BrandResponseDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'DEWALT' })
  nombre!: string;

  @ApiProperty({
    example: 17,
    description:
      'Cantidad de productos activos de la marca (acotada al proveedor si se filtró)',
  })
  totalProductos!: number;
}
