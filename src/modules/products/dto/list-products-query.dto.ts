import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  ArrayNotEmpty,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

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

/** Modos explícitos del buscador usado por el editor de listas. */
export const PRODUCT_SEARCH_MODES = [
  'name',
  'skuExact',
  'nameOrSkuExact',
] as const;
export type ProductSearchMode = (typeof PRODUCT_SEARCH_MODES)[number];

/** Filtros del listado público de productos. */
export class ListProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    type: String,
    description:
      'IDs separados por coma; OR dentro del grupo, AND entre grupos. Tiene prioridad sobre el ID singular.',
  })
  @Transform(({ value }: { value: unknown }) =>
    (Array.isArray(value) ? value : [value]).flatMap((part: unknown) =>
      typeof part === 'string' ? part.split(',').map(Number) : [part],
    ),
  )
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @IsOptional()
  supplierIds?: number[];

  @ApiPropertyOptional({
    type: String,
    description:
      'IDs separados por coma; OR dentro del grupo, AND entre grupos. Tiene prioridad sobre el ID singular.',
  })
  @Transform(({ value }: { value: unknown }) =>
    (Array.isArray(value) ? value : [value]).flatMap((part: unknown) =>
      typeof part === 'string' ? part.split(',').map(Number) : [part],
    ),
  )
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @IsOptional()
  brandIds?: number[];

  @ApiPropertyOptional({
    type: String,
    description:
      'IDs de categoría (de `GET /categories`) separados por coma; OR dentro ' +
      'del grupo, AND entre grupos. Tiene prioridad sobre el ID singular.',
  })
  @Transform(({ value }: { value: unknown }) =>
    (Array.isArray(value) ? value : [value]).flatMap((part: unknown) =>
      typeof part === 'string' ? part.split(',').map(Number) : [part],
    ),
  )
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @IsOptional()
  categoryIds?: number[];

  @ApiPropertyOptional({ description: 'Filtrar por categoría' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  categoryId?: number;

  @ApiPropertyOptional({
    type: String,
    description:
      'IDs de subcategoría separados por coma; OR dentro del grupo, AND entre ' +
      'grupos (y con `categoryIds`). Tiene prioridad sobre el ID singular.',
  })
  @Transform(({ value }: { value: unknown }) =>
    (Array.isArray(value) ? value : [value]).flatMap((part: unknown) =>
      typeof part === 'string' ? part.split(',').map(Number) : [part],
    ),
  )
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @IsOptional()
  subcategoryIds?: number[];

  @ApiPropertyOptional({ description: 'Filtrar por subcategoría' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  subcategoryId?: number;

  @ApiPropertyOptional({
    description: 'Búsqueda case-insensitive sobre nombre, sku y marca',
  })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    enum: PRODUCT_SEARCH_MODES,
    description:
      'Modo de búsqueda. Si se omite, busca como antes sobre nombre, SKU y ' +
      'marca. `name` busca por nombre parcial, `skuExact` por SKU exacto y ' +
      '`nameOrSkuExact` combina nombre parcial con SKU exacto.',
  })
  @IsIn(PRODUCT_SEARCH_MODES)
  @IsOptional()
  searchMode?: ProductSearchMode;

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
