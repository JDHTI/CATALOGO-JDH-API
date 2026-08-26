import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infrastructure/database';
import type { Prisma } from '@prisma-client';

import type { ListProductsQueryDto } from './dto/list-products-query.dto';

/** Producto con las relaciones que necesita la respuesta pública. */
export type ProductWithRelations = Prisma.ProductGetPayload<{
  include: {
    supplier: { select: { id: true; name: true } };
    brand: { select: { name: true } };
    manufacturer: { select: { name: true } };
    category: { select: { id: true; name: true } };
    subcategory: { select: { id: true; name: true } };
    images: { select: { url: true } };
  };
}>;

const PUBLIC_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  brand: { select: { name: true } },
  manufacturer: { select: { name: true } },
  category: { select: { id: true, name: true } },
  subcategory: { select: { id: true, name: true } },
  // Imagen primaria primero; solo se necesita una.
  images: {
    select: { url: true },
    orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }] as const,
    take: 1,
  },
} satisfies Prisma.ProductInclude;

/** Acceso a datos de productos (solo lectura pública). */
@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Página de productos activos + total, con búsqueda y filtro por proveedor. */
  async findActivePage(
    query: ListProductsQueryDto,
  ): Promise<{ items: ProductWithRelations[]; total: number }> {
    const where: Prisma.ProductWhereInput = {
      active: true,
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
              {
                brand: {
                  is: { name: { contains: query.search, mode: 'insensitive' } },
                },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: PUBLIC_INCLUDE,
        orderBy: { name: 'asc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items, total };
  }

  /** Producto activo por id, o `null` si no existe o está inactivo. */
  findActiveById(id: number): Promise<ProductWithRelations | null> {
    return this.prisma.product.findFirst({
      where: { id, active: true },
      include: PUBLIC_INCLUDE,
    });
  }
}
