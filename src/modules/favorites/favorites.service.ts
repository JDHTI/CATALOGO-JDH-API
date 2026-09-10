import { Injectable, NotFoundException } from '@nestjs/common';

import type { PaginatedResult, PaginationQueryDto } from '@common/index';
import type { ProductResponseDto } from '@modules/products/dto/product-response.dto';
import { toProductResponse } from '@modules/products/product.mapper';

import {
  FavoriteIdsResponseDto,
  FavoriteStateResponseDto,
} from './dto/favorites-response.dto';
import { FAVORITE_IDS_LIMIT } from './favorites.constants';
import { FavoritesRepository } from './favorites.repository';

@Injectable()
export class FavoritesService {
  constructor(private readonly favorites: FavoritesRepository) {}

  /**
   * Página de favoritos con el mismo shape `{ data, meta }` que
   * `GET /products`, y cada item es el `Producto` completo (con `imagenes`).
   * Es deliberado: la página de favoritos reusa la card del catálogo sin
   * schema nuevo y sin una segunda ronda de peticiones por producto.
   */
  async findAll(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<ProductResponseDto>> {
    const { items, total } = await this.favorites.findPage(
      userId,
      query.skip,
      query.limit,
    );

    return {
      data: items.map(toProductResponse),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  /** Ids + total: una sola petición resuelve el grid y el contador. */
  findIds(userId: string): Promise<FavoriteIdsResponseDto> {
    return this.favorites.findIds(userId, FAVORITE_IDS_LIMIT);
  }

  /** Alta idempotente; 404 si el producto no existe o está inactivo. */
  async add(
    userId: string,
    productId: number,
  ): Promise<FavoriteStateResponseDto> {
    if (!(await this.favorites.productIsActive(productId))) {
      throw new NotFoundException(`Producto ${productId} no encontrado`);
    }

    await this.favorites.add(userId, productId);
    return { productId, favorito: true };
  }

  /**
   * Baja idempotente.
   *
   * No comprueba que el producto exista: el objetivo es que el usuario deje
   * de tenerlo en favoritos, y eso ya se cumple si nunca lo tuvo. Devolver
   * 404 aquí rompería el toggle optimista de la UI en un reintento.
   */
  async remove(
    userId: string,
    productId: number,
  ): Promise<FavoriteStateResponseDto> {
    await this.favorites.remove(userId, productId);
    return { productId, favorito: false };
  }
}
