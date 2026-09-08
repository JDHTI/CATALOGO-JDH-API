import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

import { PaginationQueryDto } from '@common/index';

/**
 * Criterios de orden del listado.
 *
 * `conImagen` es OPT-IN a propósito: cambiar el orden por defecto afectaría a
 * todos los consumidores, y hay al menos uno (las sugerencias del buscador)
 * donde colar un producto con foto por encima de una coincidencia de nombre
 * más cercana no es una mejora.
 */
export const PRODUCT_ORDER_BY = ['nombre', 'conImagen'] as const;
export type ProductOrderBy = (typeof PRODUCT_ORDER_BY)[number];

/** Filtros del listado público de productos. */
export class ListProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Búsqueda case-insensitive sobre nombre, sku y marca',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Filtrar por proveedor' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  supplierId?: number;

  @ApiPropertyOptional({
    description: 'Filtrar por marca (combinable con supplierId y search)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  brandId?: number;

  @ApiPropertyOptional({
    enum: PRODUCT_ORDER_BY,
    default: 'nombre',
    description:
      'Orden del listado. `nombre`: alfabético. `conImagen`: primero los ' +
      'productos con imagen primaria, luego alfabético. En ambos casos el ' +
      'desempate final es por id.',
  })
  @IsIn(PRODUCT_ORDER_BY)
  @IsOptional()
  orderBy?: ProductOrderBy;
}
