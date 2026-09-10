import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  CurrentUser,
  JwtAuthGuard,
  PaginationQueryDto,
  type PaginatedResult,
} from '@common/index';
import type { ProductResponseDto } from '@modules/products/dto/product-response.dto';

import {
  FavoriteIdsResponseDto,
  FavoriteStateResponseDto,
} from './dto/favorites-response.dto';
import { FavoritesService } from './favorites.service';

/**
 * Favoritos por usuario: la primera superficie autenticada del catálogo.
 *
 * Todo el controlador va detrás de `JwtAuthGuard` — declarado AQUÍ y no como
 * guard global, porque `/products`, `/suppliers` y `/brands` son públicos y
 * la UI los consume sin sesión.
 *
 * Sin `HttpCacheInterceptor` a propósito: su clave de caché es la ruta + la
 * query, sin la identidad del usuario, así que cachear estas respuestas
 * serviría los favoritos de una persona a la siguiente.
 */
@ApiTags('favorites')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta el token o no es válido' })
@ApiServiceUnavailableResponse({
  description:
    'El API no tiene AUTH_JWKS_URL configurada o el JWKS no responde',
})
@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  @ApiOperation({
    summary: 'Listado paginado de los favoritos del usuario',
    description:
      'Mismo shape `{ data, meta }` que `GET /products`, y cada item es el ' +
      'producto completo (con `imagenes`). Orden: el último marcado primero. ' +
      'Solo productos activos.',
  })
  @ApiOkResponse({
    description: 'Página de productos favoritos: { data, meta }',
  })
  findAll(
    @CurrentUser() userId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<ProductResponseDto>> {
    return this.favorites.findAll(userId, query);
  }

  @Get('ids')
  @ApiOperation({
    summary: 'Ids de los favoritos del usuario, y el total',
    description:
      'Una sola petición para pintar el corazón en el grid del catálogo y ' +
      'el contador del header. `ids` se recorta a 1000; `total` nunca.',
  })
  @ApiOkResponse({ type: FavoriteIdsResponseDto })
  findIds(@CurrentUser() userId: string): Promise<FavoriteIdsResponseDto> {
    return this.favorites.findIds(userId);
  }

  @Put(':productId')
  @ApiOperation({
    summary: 'Marca un producto como favorito (idempotente)',
    description: 'Repetir la petición no falla y no duplica.',
  })
  @ApiOkResponse({ type: FavoriteStateResponseDto })
  @ApiNotFoundResponse({ description: 'El producto no existe o está inactivo' })
  add(
    @CurrentUser() userId: string,
    // Un id malformado es 400, no el 404 que devuelve el catálogo público:
    // aquí no se está consultando un recurso que pueda no existir, se está
    // pidiendo una escritura con un argumento que no se puede interpretar.
    @Param('productId', ParseIntPipe) productId: number,
  ): Promise<FavoriteStateResponseDto> {
    return this.favorites.add(userId, productId);
  }

  @Delete(':productId')
  @ApiOperation({
    summary: 'Quita un producto de favoritos (idempotente)',
    description: 'Quitar algo que no estaba devuelve éxito, no 404.',
  })
  @ApiOkResponse({ type: FavoriteStateResponseDto })
  remove(
    @CurrentUser() userId: string,
    @Param('productId', ParseIntPipe) productId: number,
  ): Promise<FavoriteStateResponseDto> {
    return this.favorites.remove(userId, productId);
  }
}
