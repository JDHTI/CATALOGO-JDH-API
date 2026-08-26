import type { BrandsRepository } from './brands.repository';
import { BrandsService } from './brands.service';

describe('BrandsService', () => {
  it('mapea las marcas al contrato de la UI (id, nombre, totalProductos)', async () => {
    const findAllWithActiveProducts = jest.fn().mockResolvedValue([
      { id: 1, name: 'DEWALT', activeProducts: 17 },
      { id: 2, name: 'MAKITA', activeProducts: 3 },
    ]);
    const repository = {
      findAllWithActiveProducts,
    } as unknown as BrandsRepository;

    const service = new BrandsService(repository);

    await expect(service.findAll({})).resolves.toEqual([
      { id: 1, nombre: 'DEWALT', totalProductos: 17 },
      { id: 2, nombre: 'MAKITA', totalProductos: 3 },
    ]);
    expect(findAllWithActiveProducts).toHaveBeenCalledWith(undefined);
  });

  it('propaga el filtro por proveedor al repositorio', async () => {
    const findAllWithActiveProducts = jest.fn().mockResolvedValue([]);
    const repository = {
      findAllWithActiveProducts,
    } as unknown as BrandsRepository;

    const service = new BrandsService(repository);

    await service.findAll({ supplierId: 5 });

    expect(findAllWithActiveProducts).toHaveBeenCalledWith(5);
  });
});
