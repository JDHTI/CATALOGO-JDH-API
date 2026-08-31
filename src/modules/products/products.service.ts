import { Injectable, NotFoundException } from '@nestjs/common';

import type { PaginatedResult } from '@common/index';

import type { ListProductsQueryDto } from './dto/list-products-query.dto';
import {
  ProductImageDto,
  ProductResponseDto,
} from './dto/product-response.dto';
import {
  ProductsRepository,
  type ProductWithRelations,
} from './products.repository';

@Injectable()
export class ProductsService {
  constructor(private readonly products: ProductsRepository) {}

  /** Listado paginado de productos activos. */
  async findAll(
    query: ListProductsQueryDto,
  ): Promise<PaginatedResult<ProductResponseDto>> {
    const { items, total } = await this.products.findActivePage(query);

    return {
      data: items.map((product) => this.toResponse(product)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  /** Detalle de un producto activo; 404 si no existe o está inactivo. */
  async findOne(id: number): Promise<ProductResponseDto> {
    const product = await this.products.findActiveById(id);
    if (!product) {
      throw new NotFoundException(`Producto ${id} no encontrado`);
    }
    return this.toResponse(product);
  }

  /** Mapea al contrato confirmado con la UI (respetar el shape tal cual). */
  private toResponse(product: ProductWithRelations): ProductResponseDto {
    return {
      id: product.id,
      sku: product.sku,
      nombre: product.name,
      descripcion: product.shortDescription,
      marca: product.brand?.name ?? null,
      fabricante: product.manufacturer?.name ?? null,
      proveedor: { id: product.supplier.id, nombre: product.supplier.name },
      categoria: product.category
        ? { id: product.category.id, nombre: product.category.name }
        : null,
      subcategoria: product.subcategory
        ? { id: product.subcategory.id, nombre: product.subcategory.name }
        : null,
      imagenUrl: product.images[0]?.cardUrl ?? product.images[0]?.url ?? null,
      imagenes: product.images.map((image) => this.toImageResponse(image)),
    };
  }

  private toImageResponse(
    image: ProductWithRelations['images'][number],
  ): ProductImageDto {
    return {
      thumbUrl: image.thumbUrl,
      cardUrl: image.cardUrl,
      fullUrl: image.fullUrl,
      alt: image.alt,
      position: image.position,
      esPrincipal: image.isPrimary,
    };
  }
}
