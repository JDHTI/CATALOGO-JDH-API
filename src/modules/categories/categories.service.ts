import { Injectable, NotFoundException } from '@nestjs/common';

import {
  CategoriesRepository,
  type CategoryNode,
} from './categories.repository';
import { CategoryResponseDto } from './dto/category-response.dto';
import type { ListCategoriesQueryDto } from './dto/list-categories-query.dto';

/** Mismo formato que produce `LogosService.slug`. */
export const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

@Injectable()
export class CategoriesService {
  constructor(private readonly categories: CategoriesRepository) {}

  /** Árbol completo de categorías visibles, sin paginación. */
  async findAll(query: ListCategoriesQueryDto): Promise<CategoryResponseDto[]> {
    const tree = await this.categories.findTree({
      supplierIds:
        query.supplierIds ??
        (query.supplierId ? [query.supplierId] : undefined),
      brandIds: query.brandIds ?? (query.brandId ? [query.brandId] : undefined),
    });
    return tree.map((node) => this.toDto(node));
  }

  /** Una categoría por slug; 404 si no existe, está oculta o no tiene productos activos. */
  async findBySlug(slug: string): Promise<CategoryResponseDto> {
    // Un slug mal formado no puede existir: se ahorra la consulta.
    const [node] = CATEGORY_SLUG_PATTERN.test(slug)
      ? await this.categories.findTree({ categorySlug: slug })
      : [];
    if (!node) {
      throw new NotFoundException(`No existe la categoría "${slug}"`);
    }
    return this.toDto(node);
  }

  private toDto(node: CategoryNode): CategoryResponseDto {
    return {
      id: node.id,
      slug: node.slug,
      nombre: node.name,
      totalProductos: node.total,
      subcategorias: node.subcategories.map((sub) => ({
        id: sub.id,
        slug: sub.slug,
        nombre: sub.name,
        totalProductos: sub.total,
      })),
    };
  }
}
