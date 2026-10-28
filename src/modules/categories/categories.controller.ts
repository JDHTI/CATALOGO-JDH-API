import { Controller, Get, Param, Query, UseInterceptors } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CacheTTL, HttpCacheInterceptor } from '@common/index';

import { CategoriesService } from './categories.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';

@ApiTags('categories')
@Controller('categories')
@UseInterceptors(HttpCacheInterceptor)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @CacheTTL(300)
  @ApiOperation({
    summary: 'Árbol de categorías con subcategorías y conteos',
    description:
      'Sin paginación, en el orden de la navegación. Solo categorías y ' +
      'subcategorías con al menos un producto activo. Alimenta el megamenú y ' +
      'el panel de filtros: luego se filtra `/products?categoryIds={id}` o ' +
      '`/products?subcategoryIds={id}`. `supplierIds`/`brandIds` acotan los ' +
      'conteos a lo ya elegido en el panel.',
  })
  @ApiOkResponse({ type: CategoryResponseDto, isArray: true })
  findAll(
    @Query() query: ListCategoriesQueryDto,
  ): Promise<CategoryResponseDto[]> {
    return this.categories.findAll(query);
  }

  @Get(':slug')
  @CacheTTL(300)
  @ApiOperation({
    summary: 'Categoría por slug',
    description:
      'Para resolver /categorias/{slug}: devuelve la categoría con sus ' +
      'subcategorías. Solo si tiene productos activos.',
  })
  @ApiOkResponse({ type: CategoryResponseDto })
  @ApiNotFoundResponse({
    description: 'No existe, está oculta o no tiene productos activos',
  })
  findBySlug(@Param('slug') slug: string): Promise<CategoryResponseDto> {
    return this.categories.findBySlug(slug);
  }
}
