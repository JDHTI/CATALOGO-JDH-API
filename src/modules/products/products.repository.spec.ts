import type { PrismaService } from '@infrastructure/database';

import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ProductsRepository } from './products.repository';

interface FindManyArgs {
  where?: {
    images?: { some?: unknown; none?: unknown };
    brandId?: number | null;
  };
  skip?: number;
  take?: number;
}

interface GroupRow {
  brandId: number | null;
  _count: { _all: number };
}

/**
 * Simula un catálogo con `withImage` productos con imagen primaria y
 * `withoutImage` sin ella, respetando `skip`/`take` como lo haría Postgres.
 * Cada fila se identifica por su bloque y su posición, para poder afirmar
 * exactamente qué tramo se pidió.
 */
function buildRepository(dataset: {
  withImage: number;
  withoutImage: number;
  groups?: GroupRow[];
}): {
  repository: ProductsRepository;
  findMany: jest.Mock;
  groupBy: jest.Mock;
} {
  const findMany = jest.fn((args: FindManyArgs) => {
    const isWithImage = Boolean(args.where?.images?.some);
    const brandId = args.where?.brandId;
    const size =
      brandId === undefined
        ? isWithImage
          ? dataset.withImage
          : dataset.withoutImage
        : (dataset.groups?.find((group) => group.brandId === brandId)?._count
            ._all ?? 0);
    const label =
      brandId === undefined ? (isWithImage ? 'con' : 'sin') : `m${brandId}`;
    const skip = args.skip ?? 0;
    const take = args.take ?? 0;

    return Promise.resolve(
      Array.from(
        { length: Math.max(0, Math.min(take, size - skip)) },
        (_, i) => ({
          id: `${label}-${skip + i}`,
        }),
      ),
    );
  });

  const count = jest.fn((args: FindManyArgs) =>
    Promise.resolve(
      args.where?.images?.some
        ? dataset.withImage
        : dataset.withImage + dataset.withoutImage,
    ),
  );

  const groupBy = jest.fn(() => Promise.resolve(dataset.groups ?? []));

  const prisma = {
    product: { findMany, count, groupBy },
    // Prisma resuelve el array en una transacción; para el test basta con
    // esperar las promesas que ya crearon los mocks.
    $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
  };

  return {
    repository: new ProductsRepository(prisma as unknown as PrismaService),
    findMany,
    groupBy,
  };
}

function listQuery(
  overrides: Partial<ListProductsQueryDto>,
): ListProductsQueryDto {
  return Object.assign(new ListProductsQueryDto(), overrides);
}

const ids = (items: unknown[]): string[] =>
  items.map((item) => (item as { id: string }).id);

describe('ProductsRepository.findActivePage con orderBy=conImagen', () => {
  it('la primera pagina sale entera del bloque con imagen', async () => {
    const { repository, findMany } = buildRepository({
      withImage: 35,
      withoutImage: 100,
    });

    const { items, total } = await repository.findActivePage(
      listQuery({ page: 1, limit: 20, orderBy: 'conImagen' }),
    );

    expect(ids(items)).toEqual(
      Array.from({ length: 20 }, (_, i) => `con-${i}`),
    );
    expect(total).toBe(135);
    // No hace falta tocar el bloque sin imagen si el primero llenó la página.
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('la pagina que cruza el limite se completa con el bloque sin imagen', async () => {
    const { repository } = buildRepository({
      withImage: 35,
      withoutImage: 100,
    });

    const { items } = await repository.findActivePage(
      listQuery({ page: 2, limit: 20, orderBy: 'conImagen' }),
    );

    // 15 que quedaban con imagen + 5 sin imagen empezando por el principio.
    expect(ids(items)).toEqual([
      ...Array.from({ length: 15 }, (_, i) => `con-${20 + i}`),
      ...Array.from({ length: 5 }, (_, i) => `sin-${i}`),
    ]);
  });

  it('las paginas siguientes continuan el bloque sin imagen sin repetir ni saltar', async () => {
    const { repository } = buildRepository({
      withImage: 35,
      withoutImage: 100,
    });

    const { items } = await repository.findActivePage(
      listQuery({ page: 3, limit: 20, orderBy: 'conImagen' }),
    );

    // La pagina 2 entrego sin-0..4, asi que la 3 arranca en sin-5.
    expect(ids(items)).toEqual(
      Array.from({ length: 20 }, (_, i) => `sin-${5 + i}`),
    );
  });

  it('sin productos con imagen la pagina es identica al orden alfabetico', async () => {
    const { repository } = buildRepository({
      withImage: 0,
      withoutImage: 50,
    });

    const { items } = await repository.findActivePage(
      listQuery({ page: 1, limit: 10, orderBy: 'conImagen' }),
    );

    expect(ids(items)).toEqual(
      Array.from({ length: 10 }, (_, i) => `sin-${i}`),
    );
  });

  it('ordena por nombre y desempata por id', async () => {
    const { repository, findMany } = buildRepository({
      withImage: 5,
      withoutImage: 5,
    });

    await repository.findActivePage(listQuery({ page: 1, limit: 10 }));

    // Sin desempate determinista, dos filas con el mismo nombre pueden salir
    // en distinto orden entre dos LIMIT/OFFSET y duplicarse entre paginas.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    );
  });
});

describe('ProductsRepository.findFeatured', () => {
  const groups: GroupRow[] = [
    { brandId: 1, _count: { _all: 23 } }, // FRUCO
    { brandId: 2, _count: { _all: 9 } }, // MAIZENA
    { brandId: 3, _count: { _all: 3 } }, // HELLMANNS
  ];

  it('reparte el cupo entre marcas en vez de llenarlo con la mas cargada', async () => {
    const { repository, findMany } = buildRepository({
      withImage: 35,
      withoutImage: 0,
      groups,
    });

    const items = await repository.findFeatured(8, 0);

    expect(items).toHaveLength(8);
    // 3 marcas y 8 cupos: 3/3/2, no 8 de FRUCO.
    const porMarca = ids(items).reduce<Record<string, number>>((acc, id) => {
      const marca = id.split('-')[0];
      acc[marca] = (acc[marca] ?? 0) + 1;
      return acc;
    }, {});
    expect(porMarca).toEqual({ m1: 3, m2: 3, m3: 2 });

    // Solo productos con imagen primaria entran a la vitrina.
    const calls = findMany.mock.calls as unknown as [FindManyArgs][];
    for (const [args] of calls) {
      expect(args.where?.images?.some).toEqual({ isPrimary: true });
    }
  });

  it('intercala las marcas para que las primeras filas no sean del mismo proveedor', async () => {
    const { repository } = buildRepository({
      withImage: 35,
      withoutImage: 0,
      groups,
    });

    const items = await repository.findFeatured(6, 0);

    expect(
      ids(items)
        .slice(0, 3)
        .map((id) => id.split('-')[0]),
    ).toEqual(['m1', 'm2', 'm3']);
  });

  it('la semilla cambia la vitrina, y la misma semilla la repite', async () => {
    const build = () =>
      buildRepository({ withImage: 35, withoutImage: 0, groups });

    const dia1 = await build().repository.findFeatured(8, 10);
    const dia1Otra = await build().repository.findFeatured(8, 10);
    const dia2 = await build().repository.findFeatured(8, 11);

    expect(ids(dia1)).toEqual(ids(dia1Otra));
    expect(ids(dia1)).not.toEqual(ids(dia2));
  });

  it('no pide a una marca mas candidatos de los que tiene', async () => {
    const { repository } = buildRepository({
      withImage: 4,
      withoutImage: 0,
      groups: [
        { brandId: 1, _count: { _all: 3 } },
        { brandId: 2, _count: { _all: 1 } },
      ],
    });

    // Se piden 8 pero solo existen 4 candidatos: devuelve 4, sin repetir.
    const items = await repository.findFeatured(8, 0);

    expect(items).toHaveLength(4);
    expect(new Set(ids(items)).size).toBe(4);
  });

  it('sin candidatos con imagen devuelve vacio sin consultar productos', async () => {
    const { repository, findMany } = buildRepository({
      withImage: 0,
      withoutImage: 100,
      groups: [],
    });

    await expect(repository.findFeatured(8, 0)).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('filtros multiples y paginacion', () => {
  it.each(['nombre', 'conImagen'] as const)(
    'combina grupos en filas y conteos con orden %s',
    async (orderBy) => {
      const findMany = jest.fn().mockResolvedValue([]);
      const count = jest.fn().mockResolvedValue(30);
      const repository = new ProductsRepository({
        product: { findMany, count },
      } as unknown as PrismaService);
      await repository.findActivePage(
        listQuery({
          supplierIds: [1, 2],
          brandIds: [3, 4],
          supplierId: 9,
          search: 'arroz',
          page: 2,
          limit: 12,
          orderBy,
        }),
      );
      const filters = {
        active: true,
        supplierId: { in: [1, 2] },
        brandId: { in: [3, 4] },
      };
      const [args] = findMany.mock.calls[0] as [
        { where: Record<string, unknown>; skip: number; take: number },
      ];
      expect(args.where).toMatchObject(filters);
      expect(args.where.OR).toBeInstanceOf(Array);
      expect(args.skip).toBe(12);
      expect(args.take).toBe(12);
      for (const [call] of count.mock.calls as [
        { where: Record<string, unknown> },
      ][]) {
        expect(call.where).toMatchObject(filters);
        expect(call.where.OR).toEqual(args.where.OR);
      }
    },
  );
});

describe('filtro por categoría y subcategoría', () => {
  const whereOf = async (
    query: Parameters<typeof listQuery>[0],
  ): Promise<Record<string, unknown>> => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const repository = new ProductsRepository({
      product: { findMany, count },
    } as unknown as PrismaService);
    await repository.findActivePage(listQuery(query));
    const [args] = findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    return args.where;
  };

  it('sin filtro de categoría no exige asignación (los pendientes siguen saliendo)', async () => {
    expect(await whereOf({})).not.toHaveProperty('categorization');
  });

  it('filtra por categoría sobre la tabla de categorización', async () => {
    expect(await whereOf({ categoryIds: [1, 2] })).toMatchObject({
      active: true,
      categorization: { is: { categoryId: { in: [1, 2] } } },
    });
  });

  it('el plural tiene prioridad sobre el singular', async () => {
    expect(await whereOf({ categoryIds: [1], categoryId: 9 })).toMatchObject({
      categorization: { is: { categoryId: { in: [1] } } },
    });
    expect(await whereOf({ categoryId: 9 })).toMatchObject({
      categorization: { is: { categoryId: { in: [9] } } },
    });
  });

  it('categoría y subcategoría se combinan con AND sobre la misma asignación', async () => {
    expect(
      await whereOf({ categoryIds: [1], subcategoryIds: [5, 6] }),
    ).toMatchObject({
      categorization: {
        is: { categoryId: { in: [1] }, subcategoryId: { in: [5, 6] } },
      },
    });
  });

  it('se combina con proveedor, marca y búsqueda', async () => {
    const where = await whereOf({
      subcategoryId: 5,
      supplierIds: [3],
      brandIds: [4],
      search: 'arroz',
    });

    expect(where).toMatchObject({
      active: true,
      supplierId: { in: [3] },
      brandId: { in: [4] },
      categorization: { is: { subcategoryId: { in: [5] } } },
    });
    expect(where.OR).toBeInstanceOf(Array);
  });
});
