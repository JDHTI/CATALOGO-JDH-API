import {
  CategoryRefDto,
  ProductImageDto,
  ProductResponseDto,
} from './dto/product-response.dto';
import type { ProductWithRelations } from './products.repository';

/**
 * Mapea un producto al contrato confirmado con la UI (respetar el shape tal
 * cual).
 *
 * Vive fuera del servicio porque no solo lo usa el listado público:
 * `/favorites` devuelve el mismo `Producto` completo para que la página de
 * favoritos reuse la card del catálogo sin un schema nuevo. Si el shape se
 * duplicara, las dos vistas se desincronizarían al primer campo que se añada.
 */
export function toProductResponse(
  product: ProductWithRelations,
): ProductResponseDto {
  return {
    id: product.id,
    sku: product.sku,
    nombre: product.name,
    descripcion: product.shortDescription,
    descripcionLarga: product.longDescription,
    seo: {
      title: product.seoTitle,
      description: product.seoDescription,
    },
    marca: product.brand?.name ?? null,
    marcaId: product.brandId,
    fabricante: product.manufacturer?.name ?? null,
    proveedor: { id: product.supplier.id, nombre: product.supplier.name },
    categoria: toCategoryRef(product.categorization?.category),
    subcategoria: toCategoryRef(product.categorization?.subcategory),
    imagenUrl: product.images[0]?.cardUrl ?? product.images[0]?.url ?? null,
    imagenes: product.images.map(toProductImageResponse),
  };
}

function toCategoryRef(
  ref: { id: number; name: string; slug: string } | null | undefined,
): CategoryRefDto | null {
  return ref ? { id: ref.id, nombre: ref.name, slug: ref.slug } : null;
}

function toProductImageResponse(
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
