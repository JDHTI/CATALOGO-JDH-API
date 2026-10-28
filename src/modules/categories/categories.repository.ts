import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infrastructure/database';
import type { Prisma } from '@prisma-client';

export interface SubcategoryNode {
  id: number;
  slug: string;
  name: string;
  total: number;
}

export interface CategoryNode {
  id: number;
  slug: string;
  name: string;
  total: number;
  subcategories: SubcategoryNode[];
}

export interface CategoryTreeFilter {
  supplierIds?: number[];
  brandIds?: number[];
  /** Acota el árbol a una sola categoría. */
  categorySlug?: string;
}

/** Acceso a datos del árbol público de categorías. */
@Injectable()
export class CategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Categorías visibles con sus subcategorías y el conteo de productos ACTIVOS.
   *
   * Solo aparece lo que tiene al menos un producto activo (y cuya categoría y
   * subcategoría estén activas): el menú nunca ofrece un callejón sin salida.
   * Es una sola agregación sobre `product_categorizations`, no una consulta
   * por categoría.
   */
  async findTree(filter: CategoryTreeFilter = {}): Promise<CategoryNode[]> {
    const product: Prisma.ProductWhereInput = {
      active: true,
      ...(filter.supplierIds?.length
        ? { supplierId: { in: filter.supplierIds } }
        : {}),
      ...(filter.brandIds?.length ? { brandId: { in: filter.brandIds } } : {}),
    };

    const counts = await this.prisma.productCategorization.groupBy({
      by: ['categoryId', 'subcategoryId'],
      where: {
        product,
        category: {
          active: true,
          ...(filter.categorySlug ? { slug: filter.categorySlug } : {}),
        },
        subcategory: { active: true },
      },
      _count: { _all: true },
    });
    if (counts.length === 0) return [];

    const categoryIds = [...new Set(counts.map((row) => row.categoryId))];
    const subcategoryIds = [...new Set(counts.map((row) => row.subcategoryId))];
    const byPosition = [{ sortOrder: 'asc' }, { name: 'asc' }] as const;

    const [categories, subcategories] = await Promise.all([
      this.prisma.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, slug: true, name: true },
        orderBy: [...byPosition],
      }),
      this.prisma.subcategory.findMany({
        where: { id: { in: subcategoryIds } },
        select: { id: true, slug: true, name: true },
        orderBy: [...byPosition],
      }),
    ]);

    const totalBySubcategory = new Map(
      counts.map((row) => [row.subcategoryId, row._count._all]),
    );
    const categoryOfSubcategory = new Map(
      counts.map((row) => [row.subcategoryId, row.categoryId]),
    );

    return categories.map((category) => {
      const children = subcategories
        .filter((sub) => categoryOfSubcategory.get(sub.id) === category.id)
        .map((sub) => ({
          id: sub.id,
          slug: sub.slug,
          name: sub.name,
          total: totalBySubcategory.get(sub.id) ?? 0,
        }));
      return {
        id: category.id,
        slug: category.slug,
        name: category.name,
        total: children.reduce((sum, sub) => sum + sub.total, 0),
        subcategories: children,
      };
    });
  }
}
