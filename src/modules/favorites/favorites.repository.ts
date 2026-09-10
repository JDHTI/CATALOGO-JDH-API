import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infrastructure/database';
import {
  PUBLIC_PRODUCT_INCLUDE,
  type ProductWithRelations,
} from '@modules/products/products.repository';
import type { Prisma } from '@prisma-client';

/**
 * Orden de la lista de favoritos: el último marcado primero.
 *
 * El desempate por `id` no es decorativo. Varios favoritos pueden compartir
 * `created_at` (un alta en lote, o dos clics dentro del mismo milisegundo) y
 * sin un criterio determinista Postgres puede devolver las filas empatadas en
 * distinto orden entre dos `LIMIT/OFFSET`: el síntoma es un producto repetido
 * en una página y otro que no sale en ninguna. Es el mismo problema que ya
 * corrigió el orden alfabético del catálogo.
 */
const ORDER_BY_RECENT: Prisma.FavoriteOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

@Injectable()
export class FavoritesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Página de productos favoritos + total.
   *
   * Se filtra por producto ACTIVO igual que el catálogo público: un producto
   * que el sync desactivó ya no se puede abrir, así que dejarlo en la lista
   * solo produciría fichas rotas. Al usar el mismo filtro que
   * `findIds`, el contador del header y el total de la página coinciden.
   */
  async findPage(
    userId: string,
    skip: number,
    take: number,
  ): Promise<{ items: ProductWithRelations[]; total: number }> {
    const where = FavoritesRepository.activeFavoritesOf(userId);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.favorite.findMany({
        where,
        select: { product: { include: PUBLIC_PRODUCT_INCLUDE } },
        orderBy: ORDER_BY_RECENT,
        skip,
        take,
      }),
      this.prisma.favorite.count({ where }),
    ]);

    return { items: rows.map((row) => row.product), total };
  }

  /**
   * Ids de los favoritos (hasta `limit`) y el total REAL, sin recortar.
   * Mismo orden que la lista, para que un recorte deje fuera los más viejos.
   */
  async findIds(
    userId: string,
    limit: number,
  ): Promise<{ ids: number[]; total: number }> {
    const where = FavoritesRepository.activeFavoritesOf(userId);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.favorite.findMany({
        where,
        select: { productId: true },
        orderBy: ORDER_BY_RECENT,
        take: limit,
      }),
      this.prisma.favorite.count({ where }),
    ]);

    return { ids: rows.map((row) => row.productId), total };
  }

  /**
   * Alta idempotente.
   *
   * `createMany` + `skipDuplicates` en vez de leer-y-luego-insertar: el índice
   * único `(user_id, product_id)` resuelve el duplicado dentro de la misma
   * sentencia, así que dos clics simultáneos no pueden cruzarse entre el
   * SELECT y el INSERT.
   */
  async add(userId: string, productId: number): Promise<void> {
    await this.prisma.favorite.createMany({
      data: { userId, productId },
      skipDuplicates: true,
    });
  }

  /** Baja idempotente: borrar algo que no está no es un error. */
  async remove(userId: string, productId: number): Promise<void> {
    await this.prisma.favorite.deleteMany({ where: { userId, productId } });
  }

  /** `true` si el producto existe y está activo. */
  async productIsActive(productId: number): Promise<boolean> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, active: true },
      select: { id: true },
    });
    return product !== null;
  }

  private static activeFavoritesOf(userId: string): Prisma.FavoriteWhereInput {
    return { userId, product: { active: true } };
  }
}
