import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infrastructure/database';
import type { Prisma } from '@prisma-client';

export interface BrandWithActiveCount {
  id: number;
  slug: string;
  name: string;
  activeProducts: number;
  logoUrl: string | null;
}

const ACTIVE_PRODUCTS: Prisma.ProductWhereInput = { active: true };

/** Acceso a datos de marcas. */
@Injectable()
export class BrandsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Marcas con al menos un producto activo (opcionalmente de un proveedor),
   * ordenadas por nombre, con el conteo de productos activos bajo el mismo
   * criterio.
   */
  async findAllWithActiveProducts(
    supplierId?: number,
    supplierIds?: number[],
  ): Promise<BrandWithActiveCount[]> {
    const productFilter: Prisma.ProductWhereInput = {
      ...ACTIVE_PRODUCTS,
      ...(supplierIds?.length
        ? { supplierId: { in: supplierIds } }
        : supplierId
          ? { supplierId }
          : {}),
    };

    const brands = await this.prisma.brand.findMany({
      where: { products: { some: productFilter } },
      orderBy: { name: 'asc' },
      select: this.select(productFilter),
    });

    return brands.map((brand) => this.toBrand(brand));
  }

  /** Marca por slug, solo si tiene productos activos. */
  async findBySlugWithActiveProducts(
    slug: string,
  ): Promise<BrandWithActiveCount | null> {
    const brand = await this.prisma.brand.findFirst({
      where: { slug, products: { some: ACTIVE_PRODUCTS } },
      select: this.select(ACTIVE_PRODUCTS),
    });
    return brand ? this.toBrand(brand) : null;
  }

  private select(productFilter: Prisma.ProductWhereInput) {
    return {
      id: true,
      slug: true,
      name: true,
      logoUrl: true,
      _count: { select: { products: { where: productFilter } } },
    } satisfies Prisma.BrandSelect;
  }

  private toBrand(brand: {
    id: number;
    slug: string;
    name: string;
    logoUrl: string | null;
    _count: { products: number };
  }): BrandWithActiveCount {
    return {
      id: brand.id,
      slug: brand.slug,
      name: brand.name,
      activeProducts: brand._count.products,
      logoUrl: brand.logoUrl,
    };
  }
}
