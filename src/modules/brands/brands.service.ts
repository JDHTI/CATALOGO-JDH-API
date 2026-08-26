import { Injectable } from '@nestjs/common';

import { BrandsRepository } from './brands.repository';
import { BrandResponseDto } from './dto/brand-response.dto';
import type { ListBrandsQueryDto } from './dto/list-brands-query.dto';

@Injectable()
export class BrandsService {
  constructor(private readonly brands: BrandsRepository) {}

  /** Lista completa (sin paginación) de marcas con productos activos. */
  async findAll(query: ListBrandsQueryDto): Promise<BrandResponseDto[]> {
    const brands = await this.brands.findAllWithActiveProducts(
      query.supplierId,
    );

    return brands.map((brand) => ({
      id: brand.id,
      nombre: brand.name,
      totalProductos: brand.activeProducts,
    }));
  }
}
