import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infrastructure/database';

export interface SupplierWithActiveCount {
  id: number;
  name: string;
  activeProducts: number;
}

/** Acceso a datos de proveedores. */
@Injectable()
export class SuppliersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Proveedores con al menos un producto activo, ordenados por nombre,
   * con el conteo de sus productos activos.
   */
  async findAllWithActiveProducts(): Promise<SupplierWithActiveCount[]> {
    const suppliers = await this.prisma.supplier.findMany({
      where: { products: { some: { active: true } } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        _count: { select: { products: { where: { active: true } } } },
      },
    });

    return suppliers.map((supplier) => ({
      id: supplier.id,
      name: supplier.name,
      activeProducts: supplier._count.products,
    }));
  }
}
