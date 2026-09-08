import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Cuántos destacados devuelve la home si no se pide otra cosa. */
export const FEATURED_DEFAULT_LIMIT = 8;
/** Techo del endpoint: es una vitrina, no un listado paginado. */
export const FEATURED_MAX_LIMIT = 24;

/** Parámetros de la vitrina de destacados. */
export class FeaturedProductsQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: FEATURED_MAX_LIMIT,
    default: FEATURED_DEFAULT_LIMIT,
    description: 'Cuántos destacados devolver',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FEATURED_MAX_LIMIT)
  @IsOptional()
  limit: number = FEATURED_DEFAULT_LIMIT;
}
