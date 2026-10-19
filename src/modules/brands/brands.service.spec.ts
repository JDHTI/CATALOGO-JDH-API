import { NotFoundException } from '@nestjs/common';

import type { BrandsRepository } from './brands.repository';
import { BrandsService } from './brands.service';

describe('BrandsService', () => {
  it('mapea las marcas al contrato de la UI (id, slug, nombre, totalProductos, logoUrl)', async () => {
    const findAllWithActiveProducts = jest.fn().mockResolvedValue([
      {
        id: 1,
        slug: 'dewalt',
        name: 'DEWALT',
        activeProducts: 17,
        logoUrl: 'http://s3/dewalt.png',
      },
      {
        id: 2,
        slug: 'makita',
        name: 'MAKITA',
        activeProducts: 3,
        logoUrl: null,
      },
    ]);
    const repository = {
      findAllWithActiveProducts,
    } as unknown as BrandsRepository;

    const service = new BrandsService(repository);

    await expect(service.findAll({})).resolves.toEqual([
      {
        id: 1,
        slug: 'dewalt',
        nombre: 'DEWALT',
        totalProductos: 17,
        logoUrl: 'http://s3/dewalt.png',
      },
      // Sin logo viaja null, nunca cadena vacía: el placeholder lo pone la UI.
      {
        id: 2,
        slug: 'makita',
        nombre: 'MAKITA',
        totalProductos: 3,
        logoUrl: null,
      },
    ]);
    expect(findAllWithActiveProducts).toHaveBeenCalledWith(
      undefined,
      undefined,
    );
  });

  it('propaga el filtro por proveedor al repositorio', async () => {
    const findAllWithActiveProducts = jest.fn().mockResolvedValue([]);
    const repository = {
      findAllWithActiveProducts,
    } as unknown as BrandsRepository;

    const service = new BrandsService(repository);

    await service.findAll({ supplierId: 5 });

    expect(findAllWithActiveProducts).toHaveBeenCalledWith(5, undefined);
  });

  describe('findBySlug', () => {
    it('devuelve la marca con el mismo contrato que la lista', async () => {
      const findBySlugWithActiveProducts = jest.fn().mockResolvedValue({
        id: 9,
        slug: 'nescafe-dolce-gusto',
        name: 'NESCAFE DOLCE GUSTO',
        activeProducts: 4,
        logoUrl: null,
      });
      const service = new BrandsService({
        findBySlugWithActiveProducts,
      } as unknown as BrandsRepository);

      await expect(service.findBySlug('nescafe-dolce-gusto')).resolves.toEqual({
        id: 9,
        slug: 'nescafe-dolce-gusto',
        nombre: 'NESCAFE DOLCE GUSTO',
        totalProductos: 4,
        logoUrl: null,
      });
    });

    it('404 si no existe o no tiene productos activos', async () => {
      const service = new BrandsService({
        findBySlugWithActiveProducts: jest.fn().mockResolvedValue(null),
      } as unknown as BrandsRepository);

      await expect(service.findBySlug('no-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404 sin consultar si el slug está mal formado', async () => {
      const findBySlugWithActiveProducts = jest.fn();
      const service = new BrandsService({
        findBySlugWithActiveProducts,
      } as unknown as BrandsRepository);

      await expect(service.findBySlug('DeWalt')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(findBySlugWithActiveProducts).not.toHaveBeenCalled();
    });
  });
});
