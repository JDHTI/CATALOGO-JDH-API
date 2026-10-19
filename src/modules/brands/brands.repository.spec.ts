import type { PrismaService } from '@infrastructure/database';

import { BrandsRepository } from './brands.repository';

const buildPrisma = (
  findMany: jest.Mock,
  findFirst: jest.Mock = jest.fn(),
): PrismaService =>
  ({ brand: { findMany, findFirst } }) as unknown as PrismaService;

describe('BrandsRepository.findBySlugWithActiveProducts', () => {
  it('exige productos activos y cuenta solo esos', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 3,
      slug: 'alpina',
      name: 'ALPINA',
      logoUrl: null,
      _count: { products: 12 },
    });

    const brand = await new BrandsRepository(
      buildPrisma(jest.fn(), findFirst),
    ).findBySlugWithActiveProducts('alpina');

    expect(brand).toEqual({
      id: 3,
      slug: 'alpina',
      name: 'ALPINA',
      activeProducts: 12,
      logoUrl: null,
    });
    const [{ where, select }] = findFirst.mock.calls[0] as [
      { where: unknown; select: { _count: unknown } },
    ];
    expect(where).toEqual({
      slug: 'alpina',
      products: { some: { active: true } },
    });
    expect(select._count).toEqual({
      select: { products: { where: { active: true } } },
    });
  });

  it('devuelve null si no hay marca', async () => {
    const repository = new BrandsRepository(
      buildPrisma(jest.fn(), jest.fn().mockResolvedValue(null)),
    );
    await expect(
      repository.findBySlugWithActiveProducts('nada'),
    ).resolves.toBeNull();
  });
});

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
