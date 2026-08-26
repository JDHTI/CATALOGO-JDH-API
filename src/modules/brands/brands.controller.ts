import { Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CacheTTL, HttpCacheInterceptor } from '@common/index';

import { BrandsService } from './brands.service';
import { BrandResponseDto } from './dto/brand-response.dto';
import { ListBrandsQueryDto } from './dto/list-brands-query.dto';

@ApiTags('brands')
@Controller('brands')
@UseInterceptors(HttpCacheInterceptor)
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @CacheTTL(300)
  @ApiOperation({
    summary: 'Lista completa de marcas con productos activos',
    description:
      'Sin paginación, ordenada por nombre. Solo marcas con al menos un ' +
      'producto activo. `supplierId` acota a las marcas de un proveedor.',
  })
  @ApiOkResponse({ type: BrandResponseDto, isArray: true })
  findAll(@Query() query: ListBrandsQueryDto): Promise<BrandResponseDto[]> {
    return this.brands.findAll(query);
  }
}
