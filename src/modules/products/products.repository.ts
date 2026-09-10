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
    images: {
      select: {
        url: true;
        thumbUrl: true;
        cardUrl: true;
        fullUrl: true;
        alt: true;
        position: true;
        isPrimary: true;
      };
    };
  };
}>;

/**
 * Relaciones que necesita el contrato público del producto. Exportado porque
 * `/favorites` devuelve el mismo `Producto` completo (con `imagenes`) y debe
 * traerlas en la misma consulta; si no, la página de favoritos haría N+1.
 */
export const PUBLIC_PRODUCT_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  brand: { select: { name: true } },
  manufacturer: { select: { name: true } },
  category: { select: { id: true, name: true } },
  subcategory: { select: { id: true, name: true } },
  // Primaria primero; el resto de la galería en orden de posición.
  images: {
    select: {
      url: true,
      thumbUrl: true,
      cardUrl: true,
      fullUrl: true,
      alt: true,
      position: true,
      isPrimary: true,
    },
    orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }] as const,
  },
} satisfies Prisma.ProductInclude;

/**
 * Orden alfabético con desempate por id.
 *
 * El `id` NO es decorativo: hay nombres repetidos en el catálogo del ERP
 * (mismo nombre, distinta referencia). Sin un desempate determinista Postgres
 * puede devolver dos filas empatadas en distinto orden entre dos
 * `LIMIT/OFFSET`, y el síntoma es un producto duplicado en una página y otro
 * que no aparece en ninguna.
 */
const ORDER_BY_NAME: Prisma.ProductOrderByWithRelationInput[] = [
  { name: 'asc' },
  { id: 'asc' },
];

/**
 * Un producto cuenta como «con imagen» solo si tiene imagen PRIMARIA, no si
 * tiene cualquier fila en `images`: `imagenUrl` sale de la primaria, así que
 * un producto con solo secundarias pinta placeholder y dejaría un hueco en la
 * zona de los que sí tienen foto.
 */
const HAS_PRIMARY_IMAGE = { some: { isPrimary: true } } as const;
const HAS_NO_PRIMARY_IMAGE = { none: { isPrimary: true } } as const;

/** Acceso a datos de productos (solo lectura pública). */
@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Página de productos activos + total, con búsqueda y filtro por proveedor. */
  async findActivePage(
    query: ListProductsQueryDto,
  ): Promise<{ items: ProductWithRelations[]; total: number }> {
    const where = ProductsRepository.buildWhere(query);

    if (query.orderBy === 'conImagen') {
      return this.findPageImagesFirst(where, query.skip, query.limit);
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: PUBLIC_PRODUCT_INCLUDE,
        orderBy: ORDER_BY_NAME,
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items, total };
  }

  /** Filtros comunes del listado público: siempre sobre productos activos. */
  private static buildWhere(
    query: ListProductsQueryDto,
  ): Prisma.ProductWhereInput {
    return {
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
  }

  /**
   * Página con los productos con imagen primaria al frente.
   *
   * Se resuelve en DOS BLOQUES paginados por separado en vez de un `ORDER BY`
   * compuesto porque Prisma no sabe ordenar por un `EXISTS` sobre una relación
   * filtrada. El `where` base se comparte con el orden alfabético, así que los
   * filtros (búsqueda, proveedor, marca) no se duplican.
   */
  private async findPageImagesFirst(
    baseWhere: Prisma.ProductWhereInput,
    skip: number,
    take: number,
  ): Promise<{ items: ProductWithRelations[]; total: number }> {
    const withImage = { ...baseWhere, images: HAS_PRIMARY_IMAGE };
    const withoutImage = { ...baseWhere, images: HAS_NO_PRIMARY_IMAGE };

    const [withImageTotal, total] = await this.prisma.$transaction([
      this.prisma.product.count({ where: withImage }),
      this.prisma.product.count({ where: baseWhere }),
    ]);

    const items: ProductWithRelations[] = [];

    // Tramo de la página que cae dentro del bloque con imagen.
    if (skip < withImageTotal) {
      items.push(
        ...(await this.prisma.product.findMany({
          where: withImage,
          include: PUBLIC_PRODUCT_INCLUDE,
          orderBy: ORDER_BY_NAME,
          skip,
          take,
        })),
      );
    }

    // Resto de la página desde el bloque sin imagen. Cuando la página empieza
    // pasado el primer bloque, el offset se recuenta desde el inicio del
    // segundo; cuando lo cruza por la mitad, arranca en 0 y solo se pide lo
    // que falta para completar `take`.
    if (items.length < take) {
      items.push(
        ...(await this.prisma.product.findMany({
          where: withoutImage,
          include: PUBLIC_PRODUCT_INCLUDE,
          orderBy: ORDER_BY_NAME,
          skip: Math.max(0, skip - withImageTotal),
          take: take - items.length,
        })),
      );
    }

    return { items, total };
  }

  /** Producto activo por id, o `null` si no existe o está inactivo. */
  findActiveById(id: number): Promise<ProductWithRelations | null> {
    return this.prisma.product.findFirst({
      where: { id, active: true },
      include: PUBLIC_PRODUCT_INCLUDE,
    });
  }

  /**
   * Destacados de la home: solo productos con imagen primaria, repartidos
   * entre marcas y rotados con `seed`.
   *
   * No se trae el pool completo de candidatos a memoria: se cuenta por marca
   * (barato) y se pide solo la ventana asignada a cada una, así el costo no
   * crece con cada proveedor cuyas imágenes se carguen.
   */
  async findFeatured(
    limit: number,
    seed: number,
  ): Promise<ProductWithRelations[]> {
    const candidates: Prisma.ProductWhereInput = {
      active: true,
      images: HAS_PRIMARY_IMAGE,
    };

    const groups = await this.prisma.product.groupBy({
      by: ['brandId'],
      where: candidates,
      _count: { _all: true },
    });
    if (groups.length === 0) return [];

    // Orden de marcas rotado por `seed`: estable dentro de la ventana, pero
    // sin dejar siempre la misma marca al frente de la home.
    const brands = groups
      .map((group) => ({
        brandId: group.brandId,
        total: group._count._all,
      }))
      .sort((a, b) => (a.brandId ?? 0) - (b.brandId ?? 0));
    const rotated = rotate(brands, seed % brands.length);

    // Reparto round-robin: una por marca por vuelta hasta llenar `limit`, sin
    // pedirle a una marca más candidatos de los que tiene. Con 3 marcas y
    // limit 8 salen 3/3/2 en vez de 8 de la marca más cargada.
    const quota = new Map<number, number>();
    let assigned = 0;
    while (assigned < limit) {
      const before = assigned;
      for (const brand of rotated) {
        if (assigned >= limit) break;
        const key = brand.brandId ?? 0;
        const current = quota.get(key) ?? 0;
        if (current >= brand.total) continue;
        quota.set(key, current + 1);
        assigned++;
      }
      // Ninguna marca tiene stock libre: hay menos candidatos que `limit`.
      if (assigned === before) break;
    }

    const perBrand = await Promise.all(
      rotated.map((brand) =>
        this.findBrandWindow(brand, quota.get(brand.brandId ?? 0) ?? 0, seed),
      ),
    );

    // Intercalado por marca: que las primeras filas de la home no sean todas
    // del mismo proveedor.
    return interleave(perBrand).slice(0, limit);
  }

  /**
   * Ventana de candidatos de una marca, empezando en un offset derivado de
   * `seed` y dando la vuelta al principio si se pasa del final.
   */
  private async findBrandWindow(
    brand: { brandId: number | null; total: number },
    take: number,
    seed: number,
  ): Promise<ProductWithRelations[]> {
    if (take === 0) return [];

    const where: Prisma.ProductWhereInput = {
      active: true,
      images: HAS_PRIMARY_IMAGE,
      brandId: brand.brandId,
    };
    const query = {
      where,
      include: PUBLIC_PRODUCT_INCLUDE,
      orderBy: ORDER_BY_NAME,
    };

    const head = await this.prisma.product.findMany({
      ...query,
      skip: seed % brand.total,
      take,
    });
    if (head.length >= take) return head;

    // `take` nunca excede `total` (lo garantiza el reparto), así que la vuelta
    // al principio no puede repetir un producto ya incluido en `head`.
    const tail = await this.prisma.product.findMany({
      ...query,
      skip: 0,
      take: take - head.length,
    });
    return [...head, ...tail];
  }
}

/** Rota un arreglo `offset` posiciones a la izquierda. */
function rotate<T>(items: T[], offset: number): T[] {
  if (items.length === 0) return [];
  const pivot = offset % items.length;
  return [...items.slice(pivot), ...items.slice(0, pivot)];
}

/** Toma uno de cada grupo por vuelta hasta agotarlos todos. */
function interleave<T>(groups: T[][]): T[] {
  const longest = Math.max(0, ...groups.map((group) => group.length));
  const result: T[] = [];

  for (let index = 0; index < longest; index++) {
    for (const group of groups) {
      if (index < group.length) result.push(group[index]);
    }
  }

  return result;
}
