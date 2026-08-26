import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CacheTTL, HttpCacheInterceptor } from '@common/index';

import { SupplierResponseDto } from './dto/supplier-response.dto';
import { SuppliersService } from './suppliers.service';

@ApiTags('suppliers')
@Controller('suppliers')
@UseInterceptors(HttpCacheInterceptor)
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @CacheTTL(300)
  @ApiOperation({
    summary: 'Lista completa de proveedores con productos activos',
    description:
      'Sin paginación, ordenada por nombre. Solo proveedores con al menos un producto activo.',
  })
  @ApiOkResponse({ type: SupplierResponseDto, isArray: true })
  findAll(): Promise<SupplierResponseDto[]> {
    return this.suppliers.findAll();
  }
}
