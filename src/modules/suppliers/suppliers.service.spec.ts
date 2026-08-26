import type { SuppliersRepository } from './suppliers.repository';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
  it('mapea los proveedores al contrato de la UI (id, nombre, totalProductos, logoUrl)', async () => {
    const repository = {
      findAllWithActiveProducts: jest.fn().mockResolvedValue([
        { id: 1, name: 'ACME', activeProducts: 42, logoUrl: 'http://s3/a.png' },
        { id: 2, name: 'ZETA', activeProducts: 1, logoUrl: null },
      ]),
    } as unknown as SuppliersRepository;

    const service = new SuppliersService(repository);

    await expect(service.findAll()).resolves.toEqual([
      {
        id: 1,
        nombre: 'ACME',
        totalProductos: 42,
        logoUrl: 'http://s3/a.png',
      },
      // Sin logo viaja null, nunca cadena vacía: el placeholder lo pone la UI.
      { id: 2, nombre: 'ZETA', totalProductos: 1, logoUrl: null },
    ]);
  });
});
