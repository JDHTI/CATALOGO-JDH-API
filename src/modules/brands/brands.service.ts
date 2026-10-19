import { Injectable, NotFoundException } from '@nestjs/common';

import { BRAND_SLUG_PATTERN } from './brand-slug';
import {
  BrandsRepository,
  type BrandWithActiveCount,
} from './brands.repository';
import { BrandResponseDto } from './dto/brand-response.dto';
import type { ListBrandsQueryDto } from './dto/list-brands-query.dto';

@Injectable()
export class BrandsService {
  constructor(private readonly brands: BrandsRepository) {}

  /** Lista completa (sin paginación) de marcas con productos activos. */
  async findAll(query: ListBrandsQueryDto): Promise<BrandResponseDto[]> {
    const brands = await this.brands.findAllWithActiveProducts(
      query.supplierId,
      query.supplierIds,
    );

    return brands.map((brand) => this.toDto(brand));
  }

  /** Marca por slug; 404 si no existe o no tiene productos activos. */
  async findBySlug(slug: string): Promise<BrandResponseDto> {
    // Un slug mal formado no puede existir: se ahorra la consulta.
    const brand = BRAND_SLUG_PATTERN.test(slug)
      ? await this.brands.findBySlugWithActiveProducts(slug)
      : null;
    if (!brand) {
      throw new NotFoundException(`No existe la marca "${slug}"`);
    }
    return this.toDto(brand);
  }

  private toDto(brand: BrandWithActiveCount): BrandResponseDto {
    return {
      id: brand.id,
      slug: brand.slug,
      nombre: brand.name,
      totalProductos: brand.activeProducts,
      logoUrl: brand.logoUrl,
    };
  }
}
