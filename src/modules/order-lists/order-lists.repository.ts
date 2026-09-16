import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infrastructure/database';
import {
  PUBLIC_PRODUCT_INCLUDE,
  type ProductWithRelations,
} from '@modules/products/products.repository';
import type { Prisma } from '@prisma-client';
import { ORDER_LIST_MAX_LISTS } from './order-lists.constants';

const ORDER_LIST_COUNT_INCLUDE = {
  _count: { select: { items: true } },
} satisfies Prisma.OrderListInclude;

const ORDER_LIST_ITEM_INCLUDE = {
  product: { include: PUBLIC_PRODUCT_INCLUDE },
} satisfies Prisma.OrderListItemInclude;

const ORDER_BY_LIST_UPDATED: Prisma.OrderListOrderByWithRelationInput[] = [
  { updatedAt: 'desc' },
  { id: 'desc' },
];

const ORDER_BY_ITEM_CREATED: Prisma.OrderListItemOrderByWithRelationInput[] = [
  { createdAt: 'asc' },
  { productId: 'asc' },
];

export type OrderListWithCount = Prisma.OrderListGetPayload<{
  include: typeof ORDER_LIST_COUNT_INCLUDE;
}>;

export type OrderListItemWithProduct = Prisma.OrderListItemGetPayload<{
  include: typeof ORDER_LIST_ITEM_INCLUDE;
}>;

export type ProductState = Pick<ProductWithRelations, 'id' | 'active'>;

/** Acceso a datos de las listas privadas del usuario autenticado. */
@Injectable()
export class OrderListsRepository {
  private readonly pendingCreates = new Map<
    string,
    Promise<OrderListWithCount | null>
  >();
  constructor(private readonly prisma: PrismaService) {}

  findAll(userId: string): Promise<OrderListWithCount[]> {
    return this.prisma.orderList.findMany({
      where: { userId },
      include: ORDER_LIST_COUNT_INCLUDE,
      orderBy: ORDER_BY_LIST_UPDATED,
    });
  }

  findOne(userId: string, id: string): Promise<OrderListWithCount | null> {
    return this.prisma.orderList.findFirst({
      where: { id, userId },
      include: ORDER_LIST_COUNT_INCLUDE,
    });
  }

  count(userId: string): Promise<number> {
    return this.prisma.orderList.count({ where: { userId } });
  }

  async create(
    userId: string,
    name: string,
  ): Promise<OrderListWithCount | null> {
    // Esperar fuera del pool: una ráfaga del mismo usuario no debe reservar
    // todas las conexiones mientras espera su advisory lock en PostgreSQL.
    const previous = this.pendingCreates.get(userId) ?? Promise.resolve();
    const pending = previous
      .catch(() => undefined)
      .then(() => this.createWithinLimit(userId, name));
    this.pendingCreates.set(userId, pending);
    try {
      return await pending;
    } finally {
      if (this.pendingCreates.get(userId) === pending)
        this.pendingCreates.delete(userId);
    }
  }

  private createWithinLimit(
    userId: string,
    name: string,
  ): Promise<OrderListWithCount | null> {
    return this.prisma.$transaction(async (transaction) => {
      // El límite debe comprobarse bajo el mismo bloqueo que el INSERT.
      // El bloqueo por usuario funciona también entre réplicas de la API.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`order-lists:${userId}`}, 0))`;
      const total = await transaction.orderList.count({ where: { userId } });
      if (total >= ORDER_LIST_MAX_LISTS) return null;
      return transaction.orderList.create({
        data: { userId, name },
        include: ORDER_LIST_COUNT_INCLUDE,
      });
    });
  }

  rename(
    userId: string,
    id: string,
    name: string,
  ): Promise<OrderListWithCount> {
    return this.prisma.orderList.update({
      where: { id, userId },
      data: { name },
      include: ORDER_LIST_COUNT_INCLUDE,
    });
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.orderList.deleteMany({
      where: { id, userId },
    });
    return result.count > 0;
  }

  async findItems(
    userId: string,
    listId: string,
    skip: number,
    take: number,
  ): Promise<{ items: OrderListItemWithProduct[]; total: number }> {
    const where: Prisma.OrderListItemWhereInput = {
      orderListId: listId,
      orderList: { userId },
    };

    const [items, total] = await Promise.all([
      this.prisma.orderListItem.findMany({
        where,
        include: ORDER_LIST_ITEM_INCLUDE,
        orderBy: ORDER_BY_ITEM_CREATED,
        skip,
        take,
      }),
      this.prisma.orderListItem.count({ where }),
    ]);

    return { items, total };
  }

  findItem(
    userId: string,
    listId: string,
    productId: number,
  ): Promise<OrderListItemWithProduct | null> {
    return this.prisma.orderListItem.findFirst({
      where: {
        orderListId: listId,
        productId,
        orderList: { userId },
      },
      include: ORDER_LIST_ITEM_INCLUDE,
    });
  }

  findProductState(productId: number): Promise<ProductState | null> {
    return this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, active: true },
    });
  }

  async upsertItem(
    listId: string,
    productId: number,
    quantity: number,
  ): Promise<OrderListItemWithProduct> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.orderListItem.upsert({
        where: {
          orderListId_productId: { orderListId: listId, productId },
        },
        create: { orderListId: listId, productId, quantity },
        update: { quantity },
      });

      // Las líneas son parte del borrador: su modificación también mueve la
      // lista en el orden de `GET /order-lists`.
      await transaction.orderList.update({
        where: { id: listId },
        data: { updatedAt: new Date() },
      });

      return transaction.orderListItem.findUniqueOrThrow({
        where: { orderListId_productId: { orderListId: listId, productId } },
        include: ORDER_LIST_ITEM_INCLUDE,
      });
    });
  }

  async removeItem(
    userId: string,
    listId: string,
    productId: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.orderListItem.deleteMany({
        where: {
          orderListId: listId,
          productId,
          orderList: { userId },
        },
      });
      await transaction.orderList.update({
        where: { id: listId },
        data: { updatedAt: new Date() },
      });
    });
  }
}
