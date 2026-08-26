import { ApiProperty } from '@nestjs/swagger';

/** Referencia con nombre, para proveedor/categoría/subcategoría. */
export class NamedRefDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'DISTRIBUIDORA ACME' })
  nombre!: string;
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
    description: 'URL de la imagen primaria, si existe',
  })
  imagenUrl!: string | null;
}
