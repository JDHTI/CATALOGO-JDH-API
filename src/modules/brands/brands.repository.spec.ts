import type { PrismaService } from '@infrastructure/database';

import { BrandsRepository } from './brands.repository';

const buildPrisma = (findMany: jest.Mock): PrismaService =>
  ({ brand: { findMany } }) as unknown as PrismaService;

describe('BrandsRepository', () => {
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

it('acota marcas y conteos a todos los proveedores seleccionados', async () => {
  const findMany = jest.fn().mockResolvedValue([]);
  await new BrandsRepository(buildPrisma(findMany)).findAllWithActiveProducts(
    undefined,
    [1, 2],
  );
  const filter = { active: true, supplierId: { in: [1, 2] } };
  const [args] = findMany.mock.calls[0] as [
    { where: unknown; select: { _count: unknown } },
  ];
  expect(args.where).toEqual({ products: { some: filter } });
  expect(args.select._count).toEqual({
    select: { products: { where: filter } },
  });
});
