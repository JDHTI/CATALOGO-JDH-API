import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

import { PaginationQueryDto } from '@common/index';

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
}
