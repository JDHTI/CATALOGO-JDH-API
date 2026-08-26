import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  CacheTTL,
  HttpCacheInterceptor,
  type PaginatedResult,
} from '@common/index';

import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@Controller('products')
@UseInterceptors(HttpCacheInterceptor)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @CacheTTL(300)
  @ApiOperation({
    summary: 'Listado paginado de productos activos',
    description:
      'Solo productos activos, ordenados por nombre. `search` busca ' +
      'case-insensitive sobre nombre, sku y marca.',
  })
  @ApiOkResponse({ description: 'Página de productos: { data, meta }' })
  findAll(
    @Query() query: ListProductsQueryDto,
  ): Promise<PaginatedResult<ProductResponseDto>> {
    return this.products.findAll(query);
  }

  @Get(':id')
  @CacheTTL(300)
  @ApiOperation({ summary: 'Detalle de un producto activo' })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiNotFoundResponse({ description: 'No existe o está inactivo' })
  findOne(
    // Un id malformado equivale a "no existe": el catálogo responde 404, no 400.
    @Param(
      'id',
      new ParseIntPipe({
        exceptionFactory: () => new NotFoundException('Producto no encontrado'),
      }),
    )
    id: number,
  ): Promise<ProductResponseDto> {
    return this.products.findOne(id);
  }
}
