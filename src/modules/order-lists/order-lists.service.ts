import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { PaginatedResult } from '@common/index';
import type { PaginationQueryDto } from '@common/index';

import {
  ORDER_LIST_LIMIT_REACHED_CODE,
  ORDER_LIST_MAX_LISTS,
} from './order-lists.constants';
import type { CreateOrderListDto } from './dto/create-order-list.dto';
import type { OrderListItemResponseDto } from './dto/order-list-item-response.dto';
import type { OrderListResponseDto } from './dto/order-list-response.dto';
import type { UpdateOrderListDto } from './dto/update-order-list.dto';
import type { UpsertOrderListItemDto } from './dto/upsert-order-list-item.dto';
import { OrderListsRepository } from './order-lists.repository';
import {
  toOrderListItemResponse,
  toOrderListResponse,
} from './order-lists.mapper';

export interface OrderListsResult {
  data: OrderListResponseDto[];
  meta: { total: number; maxLists: number };
}

/** Reglas de negocio y shape HTTP de las listas privadas. */
@Injectable()
export class OrderListsService {
  constructor(private readonly lists: OrderListsRepository) {}

  async findAll(userId: string): Promise<OrderListsResult> {
    const lists = await this.lists.findAll(userId);
    return {
      data: lists.map(toOrderListResponse),
      meta: { total: lists.length, maxLists: ORDER_LIST_MAX_LISTS },
    };
  }

  async create(
    userId: string,
    input: CreateOrderListDto,
  ): Promise<OrderListResponseDto> {
    const name = normalizeName(input.name);
    const created = await this.lists.create(userId, name);
    if (!created) {
      throw new ConflictException({
        code: ORDER_LIST_LIMIT_REACHED_CODE,
        message: `Un usuario no puede tener más de ${ORDER_LIST_MAX_LISTS} listas`,
      });
    }

    return toOrderListResponse(created);
  }

  async findOne(userId: string, id: string): Promise<OrderListResponseDto> {
    const list = await this.requireList(userId, id);
    return toOrderListResponse(list);
  }

  async rename(
    userId: string,
    id: string,
    input: UpdateOrderListDto,
  ): Promise<OrderListResponseDto> {
    await this.requireList(userId, id);
    const name = normalizeName(input.name);
    return toOrderListResponse(await this.lists.rename(userId, id, name));
  }

  async remove(userId: string, id: string): Promise<void> {
    const removed = await this.lists.remove(userId, id);
    if (!removed) throw new NotFoundException('Lista no encontrada');
  }

  async findItems(
    userId: string,
    listId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<OrderListItemResponseDto>> {
    await this.requireList(userId, listId);
    const { items, total } = await this.lists.findItems(
      userId,
      listId,
      query.skip,
      query.limit,
    );

    return {
      data: items.map(toOrderListItemResponse),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async upsertItem(
    userId: string,
    listId: string,
    productId: number,
    input: UpsertOrderListItemDto,
  ): Promise<OrderListItemResponseDto> {
    await this.requireList(userId, listId);
    const product = await this.lists.findProductState(productId);
    if (!product) throw new NotFoundException('Producto no encontrado');

    // Las líneas históricas inactivas se pueden conservar y ajustar, pero
    // nunca se crea una nueva línea para un producto que ya no está activo.
    if (!product.active) {
      const existing = await this.lists.findItem(userId, listId, productId);
      if (!existing) throw new NotFoundException('Producto no encontrado');
    }

    const item = await this.lists.upsertItem(listId, productId, input.quantity);
    return toOrderListItemResponse(item);
  }

  async removeItem(
    userId: string,
    listId: string,
    productId: number,
  ): Promise<void> {
    await this.requireList(userId, listId);
    await this.lists.removeItem(userId, listId, productId);
  }

  private async requireList(userId: string, id: string) {
    const list = await this.lists.findOne(userId, id);
    if (!list) throw new NotFoundException('Lista no encontrada');
    return list;
  }
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (!name) {
    throw new BadRequestException('El nombre de la lista no puede estar vacío');
  }
  if (name.length > 100) {
    throw new BadRequestException(
      'El nombre de la lista no puede superar 100 caracteres',
    );
  }
  return name;
}
