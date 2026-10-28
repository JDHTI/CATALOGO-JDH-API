import { ApiProperty } from '@nestjs/swagger';

/** Subcategoría tal como la consume la UI del catálogo. */
export class SubcategoryResponseDto {
  @ApiProperty({ example: 12 })
  id!: number;

  @ApiProperty({
    example: 'aceites-y-grasas',
    description:
      'Identificador estable para URLs; único dentro de su categoría',
  })
  slug!: string;

  @ApiProperty({ example: 'Aceites y grasas' })
  nombre!: string;

  @ApiProperty({
    example: 340,
    description:
      'Productos activos de la subcategoría (acotados a proveedor/marca si se filtró)',
  })
  totalProductos!: number;
}

/** Categoría con sus subcategorías, para el megamenú y el panel de filtros. */
export class CategoryResponseDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({
    example: 'alimentos',
    description: 'Identificador estable para URLs (/categorias/{slug})',
  })
  slug!: string;

  @ApiProperty({ example: 'Alimentos' })
  nombre!: string;

  @ApiProperty({
    example: 3279,
    description:
      'Productos activos de la categoría (acotados a proveedor/marca si se filtró)',
  })
  totalProductos!: number;

  @ApiProperty({
    type: [SubcategoryResponseDto],
    description:
      'Solo subcategorías con productos activos, en el orden de la navegación',
  })
  subcategorias!: SubcategoryResponseDto[];
}
