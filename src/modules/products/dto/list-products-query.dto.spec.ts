import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { PAGINATION } from '@common/index';

import { ListProductsQueryDto } from './list-products-query.dto';

describe('ListProductsQueryDto', () => {
  it('sin params aplica los defaults: page=1 y limit por defecto (contrato UI)', () => {
    const dto = plainToInstance(ListProductsQueryDto, {});

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.page).toBe(PAGINATION.DEFAULT_PAGE);
    expect(dto.limit).toBe(PAGINATION.DEFAULT_LIMIT);
    expect(dto.skip).toBe(0);
    expect(dto.search).toBeUndefined();
    expect(dto.searchMode).toBeUndefined();
    expect(dto.supplierId).toBeUndefined();
    expect(dto.brandId).toBeUndefined();
  });

  it('convierte y valida supplierId y brandId numéricos', () => {
    const dto = plainToInstance(ListProductsQueryDto, {
      supplierId: '3',
      brandId: '7',
      page: '2',
      limit: '10',
    });

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.supplierId).toBe(3);
    expect(dto.brandId).toBe(7);
    expect(dto.skip).toBe(10);
  });

  it('rechaza un limit por encima del máximo permitido', () => {
    const dto = plainToInstance(ListProductsQueryDto, {
      limit: String(PAGINATION.MAX_LIMIT + 1),
    });

    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('acepta los modos de búsqueda del editor de listas', () => {
    for (const searchMode of ['name', 'skuExact', 'nameOrSkuExact']) {
      const dto = plainToInstance(ListProductsQueryDto, { searchMode });

      expect(validateSync(dto)).toHaveLength(0);
      expect(dto.searchMode).toBe(searchMode);
    }
  });

  it('rechaza un modo de búsqueda desconocido', () => {
    const dto = plainToInstance(ListProductsQueryDto, {
      searchMode: 'containsEverything',
    });

    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
});
