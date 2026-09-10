import { NotFoundException } from '@nestjs/common';

import { PaginationQueryDto } from '@common/index';
import type { ProductWithRelations } from '@modules/products/products.repository';

import type { FavoritesRepository } from './favorites.repository';
import { FavoritesService } from './favorites.service';

const USER = 'usuario-opaco-123';

const product = {
  id: 10,
  sku: 'ABC-123',
  name: 'Taladro percutor',
  shortDescription: 'TALADRO 1/2',
  longDescription: null,
  seoTitle: null,
  seoDescription: null,
  supplier: { id: 1, name: 'ACME' },
  brand: { name: 'DeWalt' },
  manufacturer: null,
  category: null,
  subcategory: null,
  images: [],
} as unknown as ProductWithRelations;

interface Mocks {
  findPage: jest.Mock;
  findIds: jest.Mock;
  add: jest.Mock;
  remove: jest.Mock;
  productIsActive: jest.Mock;
}

const buildService = (
  overrides: Partial<Mocks> = {},
): { service: FavoritesService; mocks: Mocks } => {
  const mocks: Mocks = {
    findPage: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    findIds: jest.fn().mockResolvedValue({ ids: [], total: 0 }),
    add: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    productIsActive: jest.fn().mockResolvedValue(true),
    ...overrides,
  };

  return {
    service: new FavoritesService(mocks as unknown as FavoritesRepository),
    mocks,
  };
};

const buildQuery = (page: number, limit: number): PaginationQueryDto =>
  Object.assign(new PaginationQueryDto(), { page, limit });

describe('FavoritesService', () => {
  describe('findAll', () => {
    it('devuelve el mismo shape { data, meta } que el listado de productos', async () => {
      const { service, mocks } = buildService({
        findPage: jest.fn().mockResolvedValue({ items: [product], total: 3 }),
      });

      const result = await service.findAll(USER, buildQuery(1, 2));

      expect(mocks.findPage).toHaveBeenCalledWith(USER, 0, 2);
      expect(result.meta).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      // El item es el Producto completo, no solo el id: la página de
      // favoritos reusa la card del catálogo sin pedir cada producto aparte.
      expect(result.data[0]).toMatchObject({
        id: 10,
        nombre: 'Taladro percutor',
        proveedor: { id: 1, nombre: 'ACME' },
        imagenes: [],
      });
    });

    it('traslada la paginación al repositorio', async () => {
      const { service, mocks } = buildService();

      await service.findAll(USER, buildQuery(3, 12));

      expect(mocks.findPage).toHaveBeenCalledWith(USER, 24, 12);
    });
  });

  describe('findIds', () => {
    it('devuelve ids y total, con el tope aplicado a los ids', async () => {
      const { service, mocks } = buildService({
        findIds: jest.fn().mockResolvedValue({ ids: [10, 42], total: 2 }),
      });

      await expect(service.findIds(USER)).resolves.toEqual({
        ids: [10, 42],
        total: 2,
      });
      expect(mocks.findIds).toHaveBeenCalledWith(USER, 1_000);
    });
  });

  describe('add', () => {
    it('marca el favorito y devuelve el estado final', async () => {
      const { service, mocks } = buildService();

      await expect(service.add(USER, 10)).resolves.toEqual({
        productId: 10,
        favorito: true,
      });
      expect(mocks.add).toHaveBeenCalledWith(USER, 10);
    });

    it('es idempotente: repetir el alta no falla', async () => {
      const { service } = buildService();

      await service.add(USER, 10);

      await expect(service.add(USER, 10)).resolves.toEqual({
        productId: 10,
        favorito: true,
      });
    });

    it('responde 404 si el producto no existe o está inactivo', async () => {
      const { service, mocks } = buildService({
        productIsActive: jest.fn().mockResolvedValue(false),
      });

      await expect(service.add(USER, 999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mocks.add).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('quitar algo que no estaba devuelve éxito, no 404', async () => {
      const { service, mocks } = buildService();

      await expect(service.remove(USER, 999)).resolves.toEqual({
        productId: 999,
        favorito: false,
      });
      expect(mocks.remove).toHaveBeenCalledWith(USER, 999);
    });

    it('no comprueba el producto: la baja no depende de que siga en catálogo', async () => {
      const { service, mocks } = buildService({
        productIsActive: jest.fn().mockResolvedValue(false),
      });

      await expect(service.remove(USER, 10)).resolves.toEqual({
        productId: 10,
        favorito: false,
      });
      expect(mocks.productIsActive).not.toHaveBeenCalled();
    });
  });
});
