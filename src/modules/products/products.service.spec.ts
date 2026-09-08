import { NotFoundException } from '@nestjs/common';

import { FeaturedProductsQueryDto } from './dto/featured-products-query.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import type {
  ProductsRepository,
  ProductWithRelations,
} from './products.repository';
import { ProductsService } from './products.service';

const product = {
  id: 10,
  sku: 'ABC-123',
  name: 'Taladro percutor',
  shortDescription: 'TALADRO 1/2',
  supplier: { id: 1, name: 'ACME' },
  brand: { name: 'DeWalt' },
  manufacturer: null,
  category: null,
  subcategory: null,
  images: [
    {
      url: 'http://minio/jdh-catalogo/p10/card.webp',
      thumbUrl: 'http://minio/jdh-catalogo/p10/thumb.webp',
      cardUrl: 'http://minio/jdh-catalogo/p10/card.webp',
      fullUrl: 'http://minio/jdh-catalogo/p10/full.webp',
      alt: null,
      position: 0,
      isPrimary: true,
      kind: 'principal',
    },
  ],
} as unknown as ProductWithRelations;

const expectedResponse = {
  id: 10,
  sku: 'ABC-123',
  nombre: 'Taladro percutor',
  descripcion: 'TALADRO 1/2',
  marca: 'DeWalt',
  fabricante: null,
  proveedor: { id: 1, nombre: 'ACME' },
  categoria: null,
  subcategoria: null,
  imagenUrl: 'http://minio/jdh-catalogo/p10/card.webp',
  imagenes: [
    {
      thumbUrl: 'http://minio/jdh-catalogo/p10/thumb.webp',
      cardUrl: 'http://minio/jdh-catalogo/p10/card.webp',
      fullUrl: 'http://minio/jdh-catalogo/p10/full.webp',
      alt: null,
      position: 0,
      esPrincipal: true,
      tipo: 'principal',
    },
  ],
};

describe('ProductsService', () => {
  it('lista con el shape confirmado por la UI y meta de paginación', async () => {
    const repository = {
      findActivePage: jest.fn().mockResolvedValue({
        items: [product],
        total: 51,
      }),
    } as unknown as ProductsRepository;
    const service = new ProductsService(repository);

    const query = Object.assign(new ListProductsQueryDto(), {
      page: 2,
      limit: 25,
    });

    await expect(service.findAll(query)).resolves.toEqual({
      data: [expectedResponse],
      meta: { page: 2, limit: 25, total: 51, totalPages: 3 },
    });
  });

  it('devuelve el detalle de un producto activo', async () => {
    const repository = {
      findActiveById: jest.fn().mockResolvedValue(product),
    } as unknown as ProductsRepository;
    const service = new ProductsService(repository);

    await expect(service.findOne(10)).resolves.toEqual(expectedResponse);
  });

  it('lanza 404 si el producto no existe o está inactivo', async () => {
    const repository = {
      findActiveById: jest.fn().mockResolvedValue(null),
    } as unknown as ProductsRepository;
    const service = new ProductsService(repository);

    await expect(service.findOne(999)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('destacados: la semilla es el dia, estable dentro del dia', async () => {
    const seeds: number[] = [];
    const findFeatured = jest
      .fn()
      .mockImplementation((_limit: number, seed: number) => {
        seeds.push(seed);
        return Promise.resolve([product]);
      });
    const service = new ProductsService({
      findFeatured,
    } as unknown as ProductsRepository);
    const query = Object.assign(new FeaturedProductsQueryDto(), { limit: 8 });

    await service.findFeatured(query, new Date('2026-09-08T00:30:00Z'));
    await service.findFeatured(query, new Date('2026-09-08T23:30:00Z'));
    await service.findFeatured(query, new Date('2026-09-09T00:30:00Z'));

    // Dos peticiones del mismo dia deben ver la MISMA vitrina: si la semilla
    // cambiara por peticion la home parpadearia y la cache de 300s no serviria.
    expect(seeds[0]).toBe(seeds[1]);
    expect(seeds[2]).toBe(seeds[0] + 1);
    expect(findFeatured).toHaveBeenCalledWith(8, seeds[0]);
  });

  it('destacados: mismo shape { data, meta } que el listado', async () => {
    const service = new ProductsService({
      findFeatured: jest.fn().mockResolvedValue([product]),
    } as unknown as ProductsRepository);

    await expect(
      service.findFeatured(
        Object.assign(new FeaturedProductsQueryDto(), { limit: 8 }),
      ),
    ).resolves.toEqual({
      data: [expectedResponse],
      meta: { page: 1, limit: 8, total: 1, totalPages: 1 },
    });
  });

  it('devuelve null en marca/imagenUrl cuando no hay datos', async () => {
    const bare = {
      ...product,
      brand: null,
      images: [],
    } as unknown as ProductWithRelations;
    const repository = {
      findActiveById: jest.fn().mockResolvedValue(bare),
    } as unknown as ProductsRepository;
    const service = new ProductsService(repository);

    const result = await service.findOne(10);

    expect(result.marca).toBeNull();
    expect(result.imagenUrl).toBeNull();
    expect(result.imagenes).toEqual([]);
  });
});
