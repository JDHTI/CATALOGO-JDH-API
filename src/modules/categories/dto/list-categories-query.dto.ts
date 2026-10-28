import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';

const toIdList = ({ value }: { value: unknown }): unknown[] =>
  (Array.isArray(value) ? value : [value]).flatMap((part: unknown) =>
    typeof part === 'string' ? part.split(',').map(Number) : [part],
  );

/**
 * Filtros del árbol de categorías. Sirven para que los conteos del panel de
 * filtros coincidan con lo que ya se eligió (proveedor/marca): sin filtros, el
 * conteo es el del catálogo completo.
 */
export class ListCategoriesQueryDto {
  @ApiPropertyOptional({
    type: String,
    description:
      'IDs separados por coma; OR dentro del grupo, AND entre grupos. Tiene prioridad sobre el ID singular.',
  })
  @Transform(toIdList)
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @IsOptional()
  supplierIds?: number[];

  @ApiPropertyOptional({
    description: 'Contar solo productos de este proveedor',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  supplierId?: number;

  @ApiPropertyOptional({
    type: String,
    description:
      'IDs separados por coma; OR dentro del grupo, AND entre grupos. Tiene prioridad sobre el ID singular.',
  })
  @Transform(toIdList)
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @IsOptional()
  brandIds?: number[];

  @ApiPropertyOptional({ description: 'Contar solo productos de esta marca' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  brandId?: number;
}
