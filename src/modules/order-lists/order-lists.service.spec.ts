import { ConflictException, NotFoundException } from '@nestjs/common';

import { PaginationQueryDto } from '@common/index';
import type { ProductWithRelations } from '@modules/products/products.repository';

import {
  ORDER_LIST_LIMIT_REACHED_CODE,
  ORDER_LIST_MAX_LISTS,
} from './order-lists.constants';
import type { CreateOrderListDto } from './dto/create-order-list.dto';
import type { UpdateOrderListDto } from './dto/update-order-list.dto';
import type { UpsertOrderListItemDto } from './dto/upsert-order-list-item.dto';
import type { OrderListsRepository } from './order-lists.repository';
import { OrderListsService } from './order-lists.service';

const USER = 'usuario-opaco-123';
const CREATED_AT = new Date('2026-09-15T12:00:00.000Z');
const UPDATED_AT = new Date('2026-09-15T12:15:00.000Z');

const product = {
  id: 42,
  sku: 'ABC-123',
  name: 'Café molido',
  shortDescription: 'REF-42',
  longDescription: null,
  seoTitle: null,
  seoDescription: null,
  active: true,
  supplier: { id: 1, name: 'ACME' },
  brand: null,
  manufacturer: null,
  category: null,
  subcategory: null,
  images: [],
} as unknown as ProductWithRelations;

const list = {
  id: 'lista-1',
  userId: USER,
  name: 'Cafetería',
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  _count: { items: 1 },
};

const item = {
  orderListId: list.id,
  productId: product.id,
  quantity: 2,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  product,
};

interface Mocks {
  findAll: jest.Mock;
  findOne: jest.Mock;
  count: jest.Mock;
  create: jest.Mock;
  rename: jest.Mock;
  remove: jest.Mock;
  findItems: jest.Mock;
  findItem: jest.Mock;
  findProductState: jest.Mock;
  upsertItem: jest.Mock;
  removeItem: jest.Mock;
}

function buildService(overrides: Partial<Mocks> = {}): {
  service: OrderListsService;
  mocks: Mocks;
} {
  const mocks: Mocks = {
    findAll: jest.fn().mockResolvedValue([list]),
    findOne: jest.fn().mockResolvedValue(list),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockResolvedValue(list),
    rename: jest.fn().mockResolvedValue(list),
    remove: jest.fn().mockResolvedValue(true),
    findItems: jest.fn().mockResolvedValue({ items: [item], total: 1 }),
    findItem: jest.fn().mockResolvedValue(item),
    findProductState: jest
      .fn()
      .mockResolvedValue({ id: product.id, active: true }),
    upsertItem: jest.fn().mockResolvedValue(item),
    removeItem: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return {
    service: new OrderListsService(mocks as unknown as OrderListsRepository),
    mocks,
  };
}

const input = (name: string): CreateOrderListDto => ({ name });
const renameInput = (name: string): UpdateOrderListDto => ({ name });
const quantityInput = (quantity: number): UpsertOrderListItemDto => ({
  quantity,
});

describe('OrderListsService', () => {
  it('lista solo lo que devuelve el repositorio del usuario y expone maxLists', async () => {
    const { service, mocks } = buildService();

    await expect(service.findAll(USER)).resolves.toEqual({
      data: [
        expect.objectContaining({
          id: list.id,
          name: list.name,
          itemCount: 1,
          createdAt: CREATED_AT.toISOString(),
          updatedAt: UPDATED_AT.toISOString(),
        }),
      ],
      meta: { total: 1, maxLists: ORDER_LIST_MAX_LISTS },
    });
    expect(mocks.findAll).toHaveBeenCalledWith(USER);
  });

  it('recorta el nombre al crear', async () => {
    const { service, mocks } = buildService();

    await service.create(USER, input('  Mi lista  '));

    expect(mocks.create).toHaveBeenCalledWith(USER, 'Mi lista');
  });

  it('devuelve el error contractual al alcanzar diez listas', async () => {
    const { service, mocks } = buildService({
      create: jest.fn().mockResolvedValue(null),
    });

    let error: unknown;
    try {
      await service.create(USER, input('Otra'));
    } catch (value: unknown) {
      error = value;
    }

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: ORDER_LIST_LIMIT_REACHED_CODE,
    });
    expect(mocks.create).toHaveBeenCalledWith(USER, 'Otra');
  });

  it('no permite acceder ni renombrar una lista de otro usuario', async () => {
    const { service, mocks } = buildService({
      findOne: jest.fn().mockResolvedValue(null),
    });

    await expect(service.findOne(USER, 'ajena')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.rename(USER, 'ajena', renameInput('Nuevo')),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.rename).not.toHaveBeenCalled();
  });

  it('devuelve líneas paginadas con el producto completo y productActive', async () => {
    const { service, mocks } = buildService();
    const query = Object.assign(new PaginationQueryDto(), {
      page: 2,
      limit: 1,
    });

    const result = await service.findItems(USER, list.id, query);

    expect(mocks.findItems).toHaveBeenCalledWith(USER, list.id, 1, 1);
    expect(result.meta).toEqual({ page: 2, limit: 1, total: 1, totalPages: 1 });
    expect(result.data[0]).toMatchObject({
      productId: product.id,
      quantity: 2,
      productActive: true,
      product: { id: product.id, nombre: product.name },
    });
  });

  it('el PUT de una línea establece la cantidad', async () => {
    const { service, mocks } = buildService();

    await service.upsertItem(USER, list.id, product.id, quantityInput(4));

    expect(mocks.findProductState).toHaveBeenCalledWith(product.id);
    expect(mocks.upsertItem).toHaveBeenCalledWith(list.id, product.id, 4);
  });

  it('permite ajustar una línea histórica aunque el producto esté inactivo', async () => {
    const { service, mocks } = buildService({
      findProductState: jest
        .fn()
        .mockResolvedValue({ id: product.id, active: false }),
      findItem: jest.fn().mockResolvedValue(item),
    });

    await expect(
      service.upsertItem(USER, list.id, product.id, quantityInput(3)),
    ).resolves.toBeDefined();
    expect(mocks.findItem).toHaveBeenCalledWith(USER, list.id, product.id);
  });

  it('no agrega un producto inactivo que no estaba en la lista', async () => {
    const { service, mocks } = buildService({
      findProductState: jest
        .fn()
        .mockResolvedValue({ id: product.id, active: false }),
      findItem: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.upsertItem(USER, list.id, product.id, quantityInput(1)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.upsertItem).not.toHaveBeenCalled();
  });

  it('la baja de una línea requiere que la lista pertenezca al usuario', async () => {
    const { service, mocks } = buildService();

    await service.removeItem(USER, list.id, product.id);

    expect(mocks.removeItem).toHaveBeenCalledWith(USER, list.id, product.id);
  });
});
