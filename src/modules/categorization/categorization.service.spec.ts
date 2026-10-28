import type { CacheService } from '@infrastructure/cache';
import type { PrismaService } from '@infrastructure/database';

import { signatureOf } from './categorization.classifier';
import type { Taxonomy } from './categorization.data';
import { CategorizationService } from './categorization.service';

const ARROZ_RULE = {
  kind: 'lsg',
  ruleKey: 'despensa|granos|arroz',
  groupId: 7,
  support: 10,
  purity: 1,
};
const ACEITE_RULE = {
  kind: 'lsg',
  ruleKey: 'despensa|aceites|aceites liquidos',
  groupId: 8,
  support: 10,
  purity: 1,
};
const GROUPS = [
  { id: 7, subcategoryId: 70, subcategory: { categoryId: 700 } },
  { id: 8, subcategoryId: 80, subcategory: { categoryId: 800 } },
  { id: 99, subcategoryId: 990, subcategory: { categoryId: 9900 } },
];

const arroz = {
  name: 'Arroz Diana',
  linea: 'DESPENSA',
  sublinea: 'GRANOS',
  grupo: 'ARROZ',
  tipoItem: 'Inventario',
};

interface ProductRow {
  id: number;
  productoKey: string;
  name: string;
  linea: string | null;
  sublinea: string | null;
  grupo: string | null;
  tipoItem: string | null;
  categorization: {
    id: number;
    groupId: number;
    locked: boolean;
    signature: string;
  } | null;
}

const row = (id: number, overrides: Partial<ProductRow> = {}): ProductRow => ({
  id,
  productoKey: `K${id}`,
  ...arroz,
  categorization: null,
  ...overrides,
});

type Delegate = Record<string, jest.Mock>;
interface PrismaMock {
  categorizationRule: Delegate;
  productGroup: Delegate;
  product: Delegate;
  productCategorization: Delegate;
  category: Delegate;
  subcategory: Delegate;
  $transaction: jest.Mock;
}

function build(options: { products?: ProductRow[]; pending?: number } = {}): {
  service: CategorizationService;
  prisma: PrismaMock;
  invalidateByPrefix: jest.Mock;
} {
  const prisma: PrismaMock = {
    categorizationRule: {
      findMany: jest.fn().mockResolvedValue([ARROZ_RULE, ACEITE_RULE]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    productGroup: {
      findMany: jest.fn().mockResolvedValue(GROUPS),
      findFirst: jest.fn().mockResolvedValue({ id: 99 }),
      findUnique: jest.fn().mockResolvedValue({
        id: 8,
        subcategoryId: 80,
        subcategory: { categoryId: 800 },
      }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    product: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce(options.products ?? [])
        .mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(options.pending ?? 0),
    },
    productCategorization: {
      createMany: jest
        .fn()
        .mockImplementation(({ data }: { data: unknown[] }) =>
          Promise.resolve({ count: data.length }),
        ),
      update: jest.fn().mockImplementation((args: unknown) => args),
      upsert: jest.fn().mockImplementation((args: unknown) => args),
      findMany: jest.fn().mockResolvedValue([]),
    },
    category: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    subcategory: { create: jest.fn() },
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => unknown)(prisma)
        : Promise.all(arg as unknown[]),
    ),
  };
  const invalidateByPrefix = jest.fn().mockResolvedValue(0);
  const service = new CategorizationService(
    prisma as unknown as PrismaService,
    { invalidateByPrefix } as unknown as CacheService,
  );
  return { service, prisma, invalidateByPrefix };
}

type CreateArgs = { data: Record<string, unknown>[] };
const created = (prisma: PrismaMock): CreateArgs['data'] =>
  (prisma.productCategorization.createMany.mock.calls[0] as [CreateArgs])[0]
    .data;

describe('CategorizationService.reconcile', () => {
  it('clasifica un producto nuevo con las reglas y lo marca como automático', async () => {
    const { service, prisma, invalidateByPrefix } = build({
      products: [row(1)],
    });

    const summary = await service.reconcile();

    expect(created(prisma)).toEqual([
      expect.objectContaining({
        productoKey: 'K1',
        categoryId: 700,
        subcategoryId: 70,
        groupId: 7,
        source: 'regla',
        confidence: 'alta',
        needsReview: false,
        signature: signatureOf(arroz),
      }),
    ]);
    expect(summary).toMatchObject({ read: 1, created: 1, reclassified: 0 });
    expect(invalidateByPrefix).toHaveBeenCalledWith('http:');
  });

  it('marca para revisión lo que clasifica con confianza media', async () => {
    const weak = { ...ARROZ_RULE, support: 2 };
    const { service, prisma } = build({ products: [row(1)] });
    prisma.categorizationRule.findMany.mockResolvedValue([weak]);

    await service.reconcile();

    expect(created(prisma)[0]).toMatchObject({
      confidence: 'media',
      needsReview: true,
    });
  });

  it('deja pendiente (sin fila) un producto que ninguna regla ubica', async () => {
    const { service, prisma } = build({
      products: [row(1, { grupo: 'GRUPO NUEVO DEL ERP', name: 'Cosa rara' })],
      pending: 1,
    });

    const summary = await service.reconcile();

    expect(prisma.productCategorization.createMany).not.toHaveBeenCalled();
    expect(summary.pending).toBe(1);
  });

  it('manda los ítems tipo Servicio al grupo Servicios', async () => {
    const { service, prisma } = build({
      products: [row(1, { tipoItem: 'Servicio', name: 'Flete', grupo: null })],
    });

    await service.reconcile();

    expect(created(prisma)[0]).toMatchObject({
      groupId: 99,
      categoryId: 9900,
      confidence: 'alta',
    });
  });

  it('no toca lo que ya está al día', async () => {
    const { service, prisma, invalidateByPrefix } = build({
      products: [
        row(1, {
          categorization: {
            id: 5,
            groupId: 7,
            locked: false,
            signature: signatureOf(arroz),
          },
        }),
      ],
    });

    const summary = await service.reconcile();

    expect(summary).toMatchObject({
      unchanged: 1,
      created: 0,
      reclassified: 0,
    });
    expect(prisma.productCategorization.update).not.toHaveBeenCalled();
    expect(invalidateByPrefix).not.toHaveBeenCalled();
  });

  it('nunca toca una asignación bloqueada, ni aunque el ERP mueva el producto', async () => {
    const { service, prisma } = build({
      products: [
        row(1, {
          grupo: 'ACEITES LIQUIDOS',
          sublinea: 'ACEITES',
          categorization: {
            id: 5,
            groupId: 7,
            locked: true,
            signature: 'firma-vieja',
          },
        }),
      ],
    });

    const summary = await service.reconcile();

    expect(summary.unchanged).toBe(1);
    expect(prisma.productCategorization.update).not.toHaveBeenCalled();
  });

  it('reclasifica una asignación automática cuando el ERP movió el producto', async () => {
    const { service, prisma } = build({
      products: [
        row(1, {
          sublinea: 'ACEITES',
          grupo: 'ACEITES LIQUIDOS',
          categorization: {
            id: 5,
            groupId: 7,
            locked: false,
            signature: 'firma-vieja',
          },
        }),
      ],
    });

    const summary = await service.reconcile();

    expect(summary.reclassified).toBe(1);
    expect(prisma.productCategorization.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({
        groupId: 8,
        categoryId: 800,
        subcategoryId: 80,
        source: 'regla',
        confidence: 'alta',
      }) as unknown,
    });
  });

  it('si el ERP movió el producto y las reglas no resuelven, conserva y marca para revisar', async () => {
    const { service, prisma } = build({
      products: [
        row(1, {
          grupo: 'GRUPO NUEVO DEL ERP',
          name: 'Cosa rara',
          categorization: {
            id: 5,
            groupId: 7,
            locked: false,
            signature: 'firma-vieja',
          },
        }),
      ],
    });

    const summary = await service.reconcile();

    expect(summary.flagged).toBe(1);
    const [[call]] = prisma.productCategorization.update.mock.calls as [
      [{ data: Record<string, unknown> }],
    ];
    expect(call.data).toMatchObject({ needsReview: true });
    // El grupo NO cambia: se conserva lo que ya estaba.
    expect(call.data).not.toHaveProperty('groupId');
  });

  it('si el grupo no cambia solo actualiza la firma', async () => {
    const { service, prisma } = build({
      products: [
        row(1, {
          categorization: {
            id: 5,
            groupId: 7,
            locked: false,
            signature: 'firma-vieja',
          },
        }),
      ],
    });

    const summary = await service.reconcile();

    expect(summary).toMatchObject({ reclassified: 0, unchanged: 1 });
    expect(prisma.productCategorization.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { signature: signatureOf(arroz) },
    });
  });
});

describe('CategorizationService.assignManual', () => {
  it('crea la asignación bloqueada y manual, y reporta las claves desconocidas', async () => {
    const { service, prisma } = build();
    prisma.product.findMany
      .mockReset()
      .mockResolvedValue([{ productoKey: 'K1', ...arroz }]);

    const result = await service.assignManual(['K1', 'NOPE'], 8);

    expect(result).toEqual({ assigned: 1, unknownKeys: ['NOPE'] });
    expect(prisma.productCategorization.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productoKey: 'K1' },
        create: expect.objectContaining({
          source: 'manual',
          locked: true,
          groupId: 8,
          categoryId: 800,
          subcategoryId: 80,
          needsReview: false,
        }) as unknown,
        update: expect.objectContaining({
          locked: true,
          source: 'manual',
        }) as unknown,
      }),
    );
  });

  it('falla si el grupo no existe', async () => {
    const { service, prisma } = build();
    prisma.productGroup.findUnique.mockResolvedValue(null);

    await expect(service.assignManual(['K1'], 12345)).rejects.toThrow(
      /No existe el grupo 12345/,
    );
  });
});

describe('CategorizationService.importAssignments', () => {
  const codes = new Map([
    ['G1', { groupId: 7, subcategoryId: 70, categoryId: 700 }],
  ]);

  it('crea solo para productos existentes que no tienen asignación', async () => {
    const { service, prisma } = build();
    prisma.product.findMany.mockReset().mockResolvedValue([
      { productoKey: 'K1', ...arroz, categorization: null },
      { productoKey: 'K2', ...arroz, categorization: { id: 1 } },
    ]);

    const summary = await service.importAssignments(
      [
        { productoKey: 'K1', groupCode: 'G1', confidence: 'alta' },
        { productoKey: 'K2', groupCode: 'G1', confidence: 'alta' },
        { productoKey: 'K3', groupCode: 'G1', confidence: 'baja' },
      ],
      codes,
    );

    expect(summary).toEqual({
      read: 3,
      created: 1,
      alreadyAssigned: 1,
      unknownProducts: 1,
    });
    expect(created(prisma)).toEqual([
      expect.objectContaining({
        productoKey: 'K1',
        source: 'propuesta',
        confidence: 'alta',
        needsReview: false,
      }),
    ]);
  });

  it('la confianza baja queda pendiente de revisión', async () => {
    const { service, prisma } = build();
    prisma.product.findMany
      .mockReset()
      .mockResolvedValue([
        { productoKey: 'K1', ...arroz, categorization: null },
      ]);

    await service.importAssignments(
      [{ productoKey: 'K1', groupCode: 'G1', confidence: 'baja' }],
      codes,
    );

    expect(created(prisma)[0]).toMatchObject({
      confidence: 'baja',
      needsReview: true,
    });
  });

  it('rechaza un código de grupo desconocido antes de escribir nada', async () => {
    const { service, prisma } = build();

    await expect(
      service.importAssignments(
        [{ productoKey: 'K1', groupCode: 'G404', confidence: 'alta' }],
        codes,
      ),
    ).rejects.toThrow(/G404/);
    expect(prisma.productCategorization.createMany).not.toHaveBeenCalled();
  });
});

describe('CategorizationService.seedTaxonomy', () => {
  const taxonomy: Taxonomy = {
    version: 'test',
    categories: [
      {
        name: 'Alimentos',
        sortOrder: 0,
        active: true,
        subcategories: [
          {
            name: 'Aceites y grasas',
            sortOrder: 0,
            groups: [
              { code: 'G1', name: 'Aceites líquidos', sortOrder: 0 },
              { code: 'G2', name: 'Margarinas', sortOrder: 1 },
            ],
          },
        ],
      },
    ],
  };

  it('crea lo que falta con su slug', async () => {
    const { service, prisma } = build();
    prisma.category.create.mockResolvedValue({
      id: 1,
      name: 'Alimentos',
      slug: 'alimentos',
    });
    prisma.subcategory.create.mockResolvedValue({
      id: 5,
      name: 'Aceites y grasas',
      slug: 'aceites-y-grasas',
    });

    const summary = await service.seedTaxonomy(taxonomy);

    expect(prisma.category.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Alimentos',
        slug: 'alimentos',
        active: true,
      }) as unknown,
    });
    expect(prisma.productGroup.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          name: 'Aceites líquidos',
          slug: 'aceites-liquidos',
        }),
        expect.objectContaining({ name: 'Margarinas', slug: 'margarinas' }),
      ],
      skipDuplicates: true,
    });
    expect(summary).toEqual({
      categories: { created: 1, existing: 0 },
      subcategories: { created: 1, existing: 0 },
      groups: { created: 2, existing: 0 },
    });
  });

  it('es create-only: no toca lo que ya existe', async () => {
    const { service, prisma, invalidateByPrefix } = build();
    prisma.category.findMany.mockResolvedValue([
      {
        id: 1,
        name: 'Alimentos',
        slug: 'comida-renombrada',
        // La persona ya reordenó y ocultó la categoría: el seed no lo revierte.
        sortOrder: 9,
        active: false,
        subcategories: [
          {
            id: 5,
            name: 'Aceites y grasas',
            slug: 'aceites-y-grasas',
            groups: [
              { id: 9, name: 'Aceites líquidos', slug: 'aceites-liquidos' },
              { id: 10, name: 'Margarinas', slug: 'margarinas' },
            ],
          },
        ],
      },
    ]);

    const summary = await service.seedTaxonomy(taxonomy);

    expect(prisma.category.create).not.toHaveBeenCalled();
    expect(prisma.subcategory.create).not.toHaveBeenCalled();
    expect(prisma.productGroup.createMany).not.toHaveBeenCalled();
    expect(summary.categories).toEqual({ created: 0, existing: 1 });
    expect(summary.groups).toEqual({ created: 0, existing: 2 });
    expect(invalidateByPrefix).not.toHaveBeenCalled();
  });
});
