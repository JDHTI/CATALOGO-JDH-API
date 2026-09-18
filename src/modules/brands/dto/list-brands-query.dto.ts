import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  ArrayNotEmpty,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';

/** Filtros del listado de marcas. */
export class ListBrandsQueryDto {
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
    description: 'Acotar a las marcas con productos activos de este proveedor',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  supplierId?: number;
}
