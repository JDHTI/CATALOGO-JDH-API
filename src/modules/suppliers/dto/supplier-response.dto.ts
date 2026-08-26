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

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'http://localhost:9000/jdh-catalogo/logos/proveedores/acme.png',
    description: 'URL absoluta del logo, o null si aún no se ha cargado',
  })
  logoUrl!: string | null;
}
