/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unnecessary-type-assertion */
import type { CacheService } from '@infrastructure/cache';
import type { PrismaService } from '@infrastructure/database';

import {
  ProductContentService,
  type ProductContentRecord,
} from './product-content.service';

const key = 'producto-editorial-1';
const checksum = 'a'.repeat(64);
const longDescription =
  'Una descripción editorial suficientemente extensa para explicar el producto, su presentación y el uso general que puede tener en una cocina o negocio de alimentos.';

function buildRecord(
  overrides: Partial<ProductContentRecord> = {},
): ProductContentRecord {
  return {
    productoKey: key,
    longDescription,
    seoTitle: 'Producto de cocina 500 g | JDH',
    seoDescription:
      'Producto de cocina en presentación de 500 g para surtir negocios de alimentos.',
    evidence: [{ position: 0, sourceChecksum: checksum }],
    ...overrides,
  };
}

function buildProduct(): Record<string, unknown> {
  return {
    id: 1,
    productoKey: key,
    sku: 'SKU-1',
    name: 'Producto de cocina 500 g',
    active: true,
    longDescription: null,
    seoTitle: null,
    seoDescription: null,
    supplier: { name: 'PROVEEDOR' },
    brand: { name: 'MARCA' },
    images: [
      {
        position: 0,
        isPrimary: true,
        sourceChecksum: checksum,
        fullUrl: 'https://cdn/product.webp',
      },
    ],
  };
}

function buildService(product = buildProduct()): {
  service: ProductContentService;
  prisma: {
    product: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  cache: { invalidateByPrefix: jest.Mock };
} {
  const update = jest.fn(({ data }: { data: Record<string, unknown> }) => {
    Object.assign(product, data);
    return Promise.resolve(product);
  });
  const productClient = {
    findUnique: jest.fn().mockResolvedValue(product),
    findMany: jest.fn().mockResolvedValue([]),
    update,
  };
  const prisma = {
    product: productClient,
    $transaction: jest.fn(
      async (callback: (tx: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
    ),
  };
  const cache = { invalidateByPrefix: jest.fn().mockResolvedValue(0) };
  return {
    service: new ProductContentService(
      prisma as unknown as PrismaService,
      cache as unknown as CacheService,
    ),
    prisma,
    cache,
  };
}

describe('ProductContentService', () => {
  it('valida un lote sin escribir en modo dry-run', async () => {
    const { service, prisma, cache } = buildService();

    await expect(
      service.import(
        { formatVersion: 1, products: [buildRecord()] },
        { apply: false, replace: false },
      ),
    ).resolves.toMatchObject({ total: 1, valid: 1, applied: 0, errors: [] });
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(cache.invalidateByPrefix).not.toHaveBeenCalled();
  });

  it('completa los campos vacíos y es idempotente en la segunda corrida', async () => {
    const { service, prisma, cache } = buildService();
    const input = [buildRecord()];

    await expect(
      service.import(input, { apply: true, replace: false }),
    ).resolves.toMatchObject({
      applied: 1,
      unchanged: 0,
      errors: [],
    });
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productoKey: key },
        data: expect.objectContaining({ seoTitle: input[0].seoTitle }),
      }),
    );

    await expect(
      service.import(input, { apply: true, replace: false }),
    ).resolves.toMatchObject({
      applied: 0,
      unchanged: 1,
      errors: [],
    });
    expect(cache.invalidateByPrefix).toHaveBeenCalledTimes(1);
  });

  it('rechaza evidencia obsoleta y no aplica el registro', async () => {
    const { service, prisma } = buildService();
    const result = await service.import(
      [
        buildRecord({
          evidence: [{ position: 0, sourceChecksum: 'b'.repeat(64) }],
        }),
      ],
      { apply: true, replace: false },
    );

    expect(result.valid).toBe(0);
    expect(result.errors[0]).toContain('evidencia de imagen desactualizada');
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('rechaza productoKey duplicado y contenido con HTML', async () => {
    const { service } = buildService();
    const result = await service.import(
      [
        buildRecord(),
        buildRecord({
          productoKey: 'producto-editorial-2',
          longDescription: `${longDescription}<b>no</b>`,
        }),
        buildRecord({ productoKey: key }),
      ],
      { apply: false, replace: false },
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('productoKey duplicado'),
        expect.stringContaining('texto plano'),
      ]),
    );
  });

  it('valida todo el lote antes de aplicar cualquier producto', async () => {
    const { service, prisma } = buildService();
    prisma.product.findUnique
      .mockResolvedValueOnce(buildProduct())
      .mockResolvedValueOnce({ ...buildProduct(), active: false });

    const result = await service.import(
      [buildRecord(), buildRecord({ productoKey: 'producto-editorial-2' })],
      { apply: true, replace: false },
    );

    expect(result.errors).toHaveLength(1);
    expect(result.applied).toBe(0);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });
});
