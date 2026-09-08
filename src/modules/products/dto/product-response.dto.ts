import { ApiProperty } from '@nestjs/swagger';

/** Referencia con nombre, para proveedor/categoría/subcategoría. */
export class NamedRefDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'DISTRIBUIDORA ACME' })
  nombre!: string;
}

/** Una imagen de la galería del producto, en sus 3 variantes WebP. */
export class ProductImageDto {
  @ApiProperty({ example: 'http://cdn/products/392/22837/abcd1234/thumb.webp' })
  thumbUrl!: string;

  @ApiProperty({ example: 'http://cdn/products/392/22837/abcd1234/card.webp' })
  cardUrl!: string;

  @ApiProperty({ example: 'http://cdn/products/392/22837/abcd1234/full.webp' })
  fullUrl!: string;

  @ApiProperty({ nullable: true, type: String })
  alt!: string | null;

  @ApiProperty({ example: 0 })
  position!: number;

  @ApiProperty({ example: true })
  esPrincipal!: boolean;
}

/**
 * Producto tal como lo consume la UI del catálogo.
 * Contrato CONFIRMADO con el equipo de UI: no cambiar el shape sin acordarlo.
 * No expone `activo` ni precios (los precios aún no existen en el catálogo).
 */
export class ProductResponseDto {
  @ApiProperty({ example: 10 })
  id!: number;

  @ApiProperty({ example: 'ABC-123' })
  sku!: string;

  @ApiProperty({ example: 'Taladro percutor 1/2"' })
  nombre!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Descripción corta del ERP',
  })
  descripcion!: string | null;

  @ApiProperty({ nullable: true, type: String })
  marca!: string | null;

  @ApiProperty({ nullable: true, type: String })
  fabricante!: string | null;

  @ApiProperty({ type: NamedRefDto })
  proveedor!: NamedRefDto;

  @ApiProperty({ type: NamedRefDto, nullable: true })
  categoria!: NamedRefDto | null;

  @ApiProperty({ type: NamedRefDto, nullable: true })
  subcategoria!: NamedRefDto | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'URL de la variante `card` de la imagen primaria, si existe. Se ' +
      'mantiene por compatibilidad; para la galería completa usar `imagenes`.',
  })
  imagenUrl!: string | null;

  @ApiProperty({ type: [ProductImageDto] })
  imagenes!: ProductImageDto[];
}
