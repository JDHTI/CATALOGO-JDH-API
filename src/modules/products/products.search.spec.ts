import type { PrismaService } from '@infrastructure/database';

import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ProductsRepository } from './products.repository';

function buildRepository(): {
  repository: ProductsRepository;
  findMany: jest.Mock;
} {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const prisma = {
    product: { findMany, count },
    $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
  };

  return {
    repository: new ProductsRepository(prisma as unknown as PrismaService),
    findMany,
  };
}

function query(searchMode?: ListProductsQueryDto['searchMode']) {
  return Object.assign(new ListProductsQueryDto(), {
    page: 1,
    limit: 8,
    search: '  ABC-123  ',
    searchMode,
  });
}

describe('ProductsRepository searchMode', () => {
  it('preserva la búsqueda histórica cuando se omite el modo', async () => {
    const { repository, findMany } = buildRepository();

    await repository.findActivePage(query());

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          active: true,
          OR: [
            { name: { contains: 'ABC-123', mode: 'insensitive' } },
            { sku: { contains: 'ABC-123', mode: 'insensitive' } },
            {
              brand: {
                is: { name: { contains: 'ABC-123', mode: 'insensitive' } },
              },
            },
          ],
        },
      }),
    );
  });

  it('name busca solo coincidencias parciales en nombre', async () => {
    const { repository, findMany } = buildRepository();

    await repository.findActivePage(query('name'));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          active: true,
          OR: [{ name: { contains: 'ABC-123', mode: 'insensitive' } }],
        },
      }),
    );
  });

  it('skuExact usa igualdad case-insensitive, no contains', async () => {
    const { repository, findMany } = buildRepository();

    await repository.findActivePage(query('skuExact'));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          active: true,
          OR: [{ sku: { equals: 'ABC-123', mode: 'insensitive' } }],
        },
      }),
    );
  });

  it('nameOrSkuExact combina nombre parcial con SKU exacto', async () => {
    const { repository, findMany } = buildRepository();

    await repository.findActivePage(query('nameOrSkuExact'));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          active: true,
          OR: [
            { name: { contains: 'ABC-123', mode: 'insensitive' } },
            { sku: { equals: 'ABC-123', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });
});
