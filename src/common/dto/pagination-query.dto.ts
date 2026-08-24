import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { PAGINATION } from '../constants/app.constants';

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: PAGINATION.DEFAULT_PAGE })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page: number = PAGINATION.DEFAULT_PAGE;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: PAGINATION.MAX_LIMIT,
    default: PAGINATION.DEFAULT_LIMIT,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINATION.MAX_LIMIT)
  @IsOptional()
  limit: number = PAGINATION.DEFAULT_LIMIT;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
