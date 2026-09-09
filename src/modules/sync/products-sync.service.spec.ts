import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { CacheService } from '@infrastructure/cache';
import type { PrismaService } from '@infrastructure/database';
import type { DatawarehouseService } from '@infrastructure/datawarehouse';

import type { DwhProductRow } from './dwh-product-row.interface';
import { ProductsSyncService } from './products-sync.service';

const configService = {
  getOrThrow: jest
    .fn()
    .mockReturnValue({ productsCron: '0 2 * * *', productsEnabled: true }),
} as unknown as ConfigService;

const buildRow = (
  key: string,
  overrides: Partial<DwhProductRow> = {},
): DwhProductRow => ({
  producto_key: key,
  sku: 'SKU-1',
  sku_proveedor: 'DESCRIPCION CORTA',
  descripcion: 'PRODUCTO UNO',
  fecha_creacion: new Date('2024-01-01T00:00:00Z'),
  estado: 'A',
  tipo_item: 'Inventario',
  cod_proveedor: 'P01',
  proveedor: 'ACME',
  fabricante: 'FABRICA',
  marca: 'MARCA',
  origen: null,
  linea: null,
  sublinea: null,
  grupo: null,
  peso: '1.500',
  factor_empaque: null,
  ...overrides,
});

interface PrismaMock {
  syncRun: { create: jest.Mock; update: jest.Mock };
  supplier: { upsert: jest.Mock };
  brand: { upsert: jest.Mock };
  manufacturer: { upsert: jest.Mock };
  product: {
    findMany: jest.Mock;
    createMany: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
}

/** Extrae los productos que el servicio pasó a `createMany`. */
const createdData = (
  createMany: jest.Mock,
): { productoKey: string; sourceHash: string }[] => {
  const calls = createMany.mock.calls as [
    [{ data: { productoKey: string; sourceHash: string }[] }],
  ];
  return calls[0][0].data;
};

const buildPrisma = (): PrismaMock => ({
  syncRun: {
    create: jest.fn().mockResolvedValue({ id: 7 }),
    update: jest.fn().mockResolvedValue({}),
  },
  supplier: { upsert: jest.fn().mockResolvedValue({ id: 1 }) },
  brand: { upsert: jest.fn().mockResolvedValue({ id: 2 }) },
  manufacturer: { upsert: jest.fn().mockResolvedValue({ id: 3 }) },
  product: {
    findMany: jest.fn().mockResolvedValue([]),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
});

const buildService = (
  rows: DwhProductRow[],
  prisma: PrismaMock,
  dwhEnabled = true,
): { service: ProductsSyncService; invalidateByPrefix: jest.Mock } => {
  const dwh = {
    enabled: dwhEnabled,
    stream: jest.fn(async function* (): AsyncGenerator<DwhProductRow[]> {
      if (rows.length > 0) yield rows;
      await Promise.resolve();
    }),
  } as unknown as DatawarehouseService;

  const invalidateByPrefix = jest.fn().mockResolvedValue(0);
  const cache = { invalidateByPrefix } as unknown as CacheService;

  const service = new ProductsSyncService(
    dwh,
    prisma as unknown as PrismaService,
    cache,
    configService,
  );
  return { service, invalidateByPrefix };
};

describe('ProductsSyncService.cleanName', () => {
  it('quita los símbolos de adorno del inicio', () => {
    expect(ProductsSyncService.cleanName('*Vaso 7oz Nescafe Alegria')).toBe(
      'Vaso 7oz Nescafe Alegria',
    );
    expect(ProductsSyncService.cleanName('  **  Esponja Hexagonal')).toBe(
      'Esponja Hexagonal',
    );
  });

  it('no toca el resto del nombre ni recorta caracteres legítimos', () => {
    // Unidades, medidas, comillas de pulgada y códigos del ERP se conservan.
    expect(
      ProductsSyncService.cleanName("Trident Yerbabuena 5s' 18ux8.5g"),
    ).toBe("Trident Yerbabuena 5s' 18ux8.5g");
    expect(ProductsSyncService.cleanName('Espatula Confitero14" Tramon')).toBe(
      'Espatula Confitero14" Tramon',
    );
    // Un dígito o una letra inicial NO es un adorno: se respeta.
    expect(ProductsSyncService.cleanName('1/4 Rodaja Piña Deshidratada')).toBe(
      '1/4 Rodaja Piña Deshidratada',
    );
    expect(ProductsSyncService.cleanName('Ñame Criollo x1kg')).toBe(
      'Ñame Criollo x1kg',
    );
  });

  it('devuelve cadena vacía si el nombre era solo símbolos', () => {
    // El llamador cae entonces al sku, nunca deja el producto sin nombre.
    expect(ProductsSyncService.cleanName('***')).toBe('');
  });
});

describe('ProductsSyncService', () => {
  it('falla con mensaje claro si el DWH está deshabilitado', async () => {
    const prisma = buildPrisma();
    const { service } = buildService([], prisma, false);

    await expect(service.run()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.syncRun.create).not.toHaveBeenCalled();
  });

  it('inserta productos nuevos, registra el SyncRun e invalida la caché', async () => {
    const prisma = buildPrisma();
    const rows = [buildRow('k1'), buildRow('k2', { sku: 'SKU-2' })];
    const { service, invalidateByPrefix } = buildService(rows, prisma);

    const summary = await service.run();

    expect(summary).toMatchObject({
      runId: 7,
      totalRead: 2,
      inserted: 2,
      updated: 0,
      unchanged: 0,
      deactivated: 0,
    });
    expect(prisma.product.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.supplier.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: 'P01' },
        create: { code: 'P01', name: 'ACME' },
      }),
    );
    const successData: unknown = expect.objectContaining({
      status: 'success',
      inserted: 2,
    });
    expect(prisma.syncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 }, data: successData }),
    );
    expect(invalidateByPrefix).toHaveBeenCalledWith('http:');
  });

  it('salta el update cuando el sourceHash no cambió (unchanged)', async () => {
    // Primera pasada: capturar los hashes que calcula el propio servicio.
    const firstPrisma = buildPrisma();
    const rows = [buildRow('k1'), buildRow('k2', { sku: 'SKU-2' })];
    const { service: firstService } = buildService(rows, firstPrisma);
    await firstService.run();

    const created = createdData(firstPrisma.product.createMany);

    // Segunda pasada: los productos ya existen con esos mismos hashes.
    const prisma = buildPrisma();
    prisma.product.findMany.mockResolvedValue(
      created.map(({ productoKey, sourceHash }) => ({
        productoKey,
        sourceHash,
      })),
    );
    const { service, invalidateByPrefix } = buildService(rows, prisma);

    const summary = await service.run();

    expect(summary).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    expect(prisma.product.createMany).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
    // Sin cambios ni desactivaciones no se invalida la caché.
    expect(invalidateByPrefix).not.toHaveBeenCalled();
  });

  it('actualiza cuando el hash cambió y desactiva lo que no vino', async () => {
    const firstPrisma = buildPrisma();
    const { service: firstService } = buildService(
      [buildRow('k1')],
      firstPrisma,
    );
    await firstService.run();
    const [{ productoKey }] = createdData(firstPrisma.product.createMany);

    const prisma = buildPrisma();
    prisma.product.findMany.mockResolvedValue([
      { productoKey, sourceHash: 'hash-viejo' },
    ]);
    // La desactivación final reporta 3 productos que no vinieron.
    prisma.product.updateMany.mockResolvedValue({ count: 3 });
    const { service } = buildService([buildRow('k1')], prisma);

    const summary = await service.run();

    expect(summary).toMatchObject({ updated: 1, deactivated: 3 });
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { productoKey: 'k1' } }),
    );

    const updateCalls = prisma.product.update.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    const updateArgs = updateCalls[0][0];
    expect(updateArgs.data).toEqual(
      expect.objectContaining({
        sku: 'SKU-1',
        name: 'PRODUCTO UNO',
        shortDescription: 'DESCRIPCION CORTA',
      }),
    );
    for (const catalogField of [
      'longDescription',
      'seoTitle',
      'seoDescription',
      'price',
      'priceCurrency',
      'priceUpdatedAt',
      'categoryId',
      'subcategoryId',
    ]) {
      expect(updateArgs.data).not.toHaveProperty(catalogField);
    }

    const updateManyCalls = prisma.product.updateMany.mock
      .calls as unknown as Array<[{ data: Record<string, unknown> }]>;
    expect(updateManyCalls[0][0].data).toEqual({ active: false });
  });

  it('marca el SyncRun como error si la extracción falla', async () => {
    const prisma = buildPrisma();
    const dwh = {
      enabled: true,
      // eslint-disable-next-line require-yield
      stream: jest.fn(async function* (): AsyncGenerator<DwhProductRow[]> {
        await Promise.resolve();
        throw new Error('timeout del DWH');
      }),
    } as unknown as DatawarehouseService;
    const cache = {
      invalidateByPrefix: jest.fn(),
    } as unknown as CacheService;
    const service = new ProductsSyncService(
      dwh,
      prisma as unknown as PrismaService,
      cache,
      configService,
    );

    await expect(service.run()).rejects.toThrow('timeout del DWH');
    const errorData: unknown = expect.objectContaining({
      status: 'error',
      error: 'timeout del DWH',
    });
    expect(prisma.syncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: errorData }),
    );
  });
});
