import { createHash } from 'node:crypto';

import type { CacheService } from '@infrastructure/cache';
import type { PrismaService } from '@infrastructure/database';
import type { StorageService } from '@infrastructure/storage';

import type { ImageProcessorService } from './image-processor.service';
import { ProductImagesService } from './product-images.service';

interface PrismaMock {
  supplier: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
  product: { findMany: jest.Mock };
  productImage: { findMany: jest.Mock; upsert: jest.Mock };
}

interface StorageMock {
  put: jest.Mock;
}

interface CacheMock {
  invalidateByPrefix: jest.Mock;
}

interface ProcessorMock {
  process: jest.Mock;
}

const DEFAULT_PROCESS_RESULT = {
  checksum: 'deadbeef'.repeat(8),
  originalWidth: 600,
  originalHeight: 600,
  variants: [
    { name: 'thumb', buffer: Buffer.from('t') },
    { name: 'card', buffer: Buffer.from('c') },
    { name: 'full', buffer: Buffer.from('f') },
  ],
};

function buildService(overrides: {
  supplier?: Record<string, unknown> | null;
  suppliers?: Record<string, unknown>[];
  products?: Record<string, unknown>[];
  existingImages?: Record<string, unknown>[];
}): {
  service: ProductImagesService;
  prisma: PrismaMock;
  storage: StorageMock;
  cache: CacheMock;
  processor: ProcessorMock;
} {
  const prisma: PrismaMock = {
    supplier: {
      findUnique: jest.fn().mockResolvedValue(overrides.supplier ?? null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue(overrides.suppliers ?? []),
    },
    product: {
      findMany: jest.fn().mockResolvedValue(overrides.products ?? []),
    },
    productImage: {
      findMany: jest.fn().mockResolvedValue(overrides.existingImages ?? []),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };

  const storage: StorageMock = {
    put: jest
      .fn()
      .mockImplementation((key: string) =>
        Promise.resolve({ key, url: `http://bucket/${key}` }),
      ),
  };

  const cache: CacheMock = {
    invalidateByPrefix: jest.fn().mockResolvedValue(0),
  };

  const processor: ProcessorMock = {
    process: jest.fn().mockResolvedValue(DEFAULT_PROCESS_RESULT),
  };

  const service = new ProductImagesService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    cache as unknown as CacheService,
    processor as unknown as ImageProcessorService,
  );

  return { service, prisma, storage, cache, processor };
}

describe('ProductImagesService.resolveSupplier', () => {
  it('resuelve por codigo exacto', async () => {
    const { service, prisma } = buildService({
      supplier: { id: 1, code: 'P001', name: 'ACME' },
    });

    await expect(service.resolveSupplier('P001')).resolves.toEqual({
      id: 1,
      code: 'P001',
      name: 'ACME',
    });
    expect(prisma.supplier.findFirst).not.toHaveBeenCalled();
  });

  it('cae a nombre insensible a mayusculas cuando no hay codigo', async () => {
    const { service, prisma } = buildService({});
    prisma.supplier.findFirst.mockResolvedValueOnce({
      id: 2,
      code: 'P002',
      name: 'ACO UNILEVER',
    });

    await expect(service.resolveSupplier('aco unilever')).resolves.toEqual({
      id: 2,
      code: 'P002',
      name: 'ACO UNILEVER',
    });
  });

  it('cae a slug cuando ni codigo ni nombre exacto coinciden', async () => {
    const { service } = buildService({
      suppliers: [{ id: 3, code: 'P003', name: '3M Colombia S.A.' }],
    });

    await expect(service.resolveSupplier('3m colombia s.a.')).resolves.toEqual({
      id: 3,
      code: 'P003',
      name: '3M Colombia S.A.',
    });
  });

  it('devuelve null si no hay ningun match', async () => {
    const { service } = buildService({ suppliers: [] });
    await expect(service.resolveSupplier('NO EXISTE')).resolves.toBeNull();
  });
});

describe('ProductImagesService.ingestFile', () => {
  const supplier = { id: 10, code: 'P010', name: 'DISTRIBUIDORA X' };

  it('usa el primer candidato con producto y sube las 3 variantes', async () => {
    const { service, storage, prisma, cache } = buildService({
      products: [{ id: 100 }],
      existingImages: [],
    });

    const result = await service.ingestFile({
      supplier,
      candidates: [
        { sku: 'ABC-1', position: 0, isPrimary: true },
        { sku: 'ABC', position: 1, isPrimary: true },
      ],
      buffer: Buffer.from('contenido'),
      sourceFilename: 'ABC-1.png',
      dryRun: false,
      force: false,
    });

    expect(result).toEqual({
      status: 'ok',
      sku: 'ABC-1',
      productIds: [100],
      objectKeyBase: expect.stringContaining('products/P010/ABC-1/') as unknown,
    });
    expect(storage.put).toHaveBeenCalledTimes(4); // original + 3 variantes
    expect(prisma.productImage.upsert).toHaveBeenCalledTimes(1);
    expect(cache.invalidateByPrefix).toHaveBeenCalledWith('http:');
  });

  it('salta al segundo candidato si el primero no tiene producto', async () => {
    const { service, prisma } = buildService({ products: [] });
    prisma.product.findMany
      .mockResolvedValueOnce([]) // ABC-1: sin match
      .mockResolvedValueOnce([{ id: 200 }]); // ABC posicion 1: si

    const result = await service.ingestFile({
      supplier,
      candidates: [
        { sku: 'ABC-1', position: 0, isPrimary: true },
        { sku: 'ABC', position: 1, isPrimary: true },
      ],
      buffer: Buffer.from('contenido'),
      sourceFilename: 'ABC-1.png',
      dryRun: true,
      force: false,
    });

    expect(result.status).toBe('ok');
    expect(result).toMatchObject({ sku: 'ABC', productIds: [200] });
  });

  it('devuelve error cuando ningun candidato matchea', async () => {
    const { service } = buildService({ products: [] });

    const result = await service.ingestFile({
      supplier,
      candidates: [{ sku: 'ZZZ', position: 0, isPrimary: true }],
      buffer: Buffer.from('contenido'),
      sourceFilename: 'ZZZ.png',
      dryRun: false,
      force: false,
    });

    expect(result.status).toBe('error');
  });

  it('omite el reproceso si el checksum no cambio', async () => {
    const buffer = Buffer.from('contenido');
    const checksum = createHash('sha256').update(buffer).digest('hex');
    const { service, processor, storage } = buildService({
      products: [{ id: 300 }],
      existingImages: [{ productId: 300, sourceChecksum: checksum }],
    });

    const result = await service.ingestFile({
      supplier,
      candidates: [{ sku: 'DEF', position: 0, isPrimary: true }],
      buffer,
      sourceFilename: 'DEF.png',
      dryRun: false,
      force: false,
    });

    expect(result).toMatchObject({ status: 'omitido', sku: 'DEF' });
    expect(processor.process).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('dry-run no sube ni escribe en base de datos', async () => {
    const { service, storage, prisma } = buildService({
      products: [{ id: 400 }],
    });

    const result = await service.ingestFile({
      supplier,
      candidates: [{ sku: 'GHI', position: 0, isPrimary: true }],
      buffer: Buffer.from('contenido'),
      sourceFilename: 'GHI.png',
      dryRun: true,
      force: false,
    });

    expect(result.status).toBe('ok');
    expect(storage.put).not.toHaveBeenCalled();
    expect(prisma.productImage.upsert).not.toHaveBeenCalled();
  });
});
