import type { PrismaService } from '@infrastructure/database';

import { BrandsRepository } from './brands.repository';

describe('BrandsRepository', () => {
  const buildPrisma = (findMany: jest.Mock): PrismaService =>
    ({ brand: { findMany } }) as unknown as PrismaService;

  it('cuenta solo productos activos cuando no hay proveedor', async () => {
    const findMany = jest.fn().mockResolvedValue([]);

    await new BrandsRepository(
      buildPrisma(findMany),
    ).findAllWithActiveProducts();

    const [{ where, select }] = findMany.mock.calls[0] as [
      { where: unknown; select: { _count: { select: { products: unknown } } } },
    ];
    expect(where).toEqual({ products: { some: { active: true } } });
    expect(select._count.select.products).toEqual({
      where: { active: true },
    });
  });

  it('acota el conteo al mismo proveedor que filtra la lista', async () => {
    const findMany = jest.fn().mockResolvedValue([]);

    await new BrandsRepository(buildPrisma(findMany)).findAllWithActiveProducts(
      7,
    );

    const [{ where, select }] = findMany.mock.calls[0] as [
      { where: unknown; select: { _count: { select: { products: unknown } } } },
    ];
    const expected = { active: true, supplierId: 7 };
    expect(where).toEqual({ products: { some: expected } });
    // El conteo debe usar el mismo criterio que la lista: si fuera global, la
    // UI mostraría un número que no corresponde a las marcas que enseña.
    expect(select._count.select.products).toEqual({ where: expected });
  });
});
