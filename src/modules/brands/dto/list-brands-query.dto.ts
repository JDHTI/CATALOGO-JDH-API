import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/** Filtros del listado de marcas. */
export class ListBrandsQueryDto {
  @ApiPropertyOptional({
    description: 'Acotar a las marcas con productos activos de este proveedor',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  supplierId?: number;
}
