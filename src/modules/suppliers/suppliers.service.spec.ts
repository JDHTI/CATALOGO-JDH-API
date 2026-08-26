import type { SuppliersRepository } from './suppliers.repository';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
  it('mapea los proveedores al contrato de la UI (id, nombre, totalProductos)', async () => {
    const repository = {
      findAllWithActiveProducts: jest.fn().mockResolvedValue([
        { id: 1, name: 'ACME', activeProducts: 42 },
        { id: 2, name: 'ZETA', activeProducts: 1 },
      ]),
    } as unknown as SuppliersRepository;

    const service = new SuppliersService(repository);

    await expect(service.findAll()).resolves.toEqual([
      { id: 1, nombre: 'ACME', totalProductos: 42 },
      { id: 2, nombre: 'ZETA', totalProductos: 1 },
    ]);
  });
});
