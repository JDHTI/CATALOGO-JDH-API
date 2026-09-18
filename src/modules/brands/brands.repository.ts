import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infrastructure/database';
import type { Prisma } from '@prisma-client';

export interface BrandWithActiveCount {
  id: number;
  name: string;
  activeProducts: number;
  logoUrl: string | null;
}

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
      active: true,
      ...(supplierIds?.length
        ? { supplierId: { in: supplierIds } }
        : supplierId
          ? { supplierId }
          : {}),
    };

    const brands = await this.prisma.brand.findMany({
      where: { products: { some: productFilter } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        _count: { select: { products: { where: productFilter } } },
      },
    });

    return brands.map((brand) => ({
      id: brand.id,
      name: brand.name,
      activeProducts: brand._count.products,
      logoUrl: brand.logoUrl,
    }));
  }
}
