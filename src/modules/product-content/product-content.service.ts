import { Injectable } from '@nestjs/common';

import { CacheService } from '@infrastructure/cache';
import { PrismaService } from '@infrastructure/database';
import type { Prisma } from '@prisma-client';

export interface ProductContentEvidence {
  position: number;
  sourceChecksum: string;
}

export interface ProductContentRecord {
  productoKey: string;
  longDescription: string;
  seoTitle: string;
  seoDescription: string;
  evidence: ProductContentEvidence[];
}

export interface ProductContentInventoryItem {
  productoKey: string;
  sku: string;
  name: string;
  active: boolean;
  brand: string | null;
  supplier: string;
  editorial: {
    longDescription: string | null;
    seoTitle: string | null;
    seoDescription: string | null;
  };
  images: {
    position: number;
    isPrimary: boolean;
    sourceChecksum: string;
    fullUrl: string;
  }[];
}

export interface ProductContentImportOptions {
  apply: boolean;
  replace: boolean;
}

export interface ProductContentImportSummary {
  mode: 'dry-run' | 'apply';
  total: number;
  valid: number;
  applied: number;
  unchanged: number;
  /** Valores editoriales que se conservaron porque ya estaban diligenciados. */
  preserved: number;
  /** Registros que requieren corrección antes de poder aplicarse. */
  pending: number;
  errors: string[];
}

const CONTENT_PRODUCT_INCLUDE = {
  supplier: { select: { name: true } },
  brand: { select: { name: true } },
  images: {
    select: {
      position: true,
      isPrimary: true,
      sourceChecksum: true,
      fullUrl: true,
    },
    orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }] as const,
  },
} satisfies Prisma.ProductInclude;

type ProductContentSnapshot = Prisma.ProductGetPayload<{
  include: typeof CONTENT_PRODUCT_INCLUDE;
}>;

const HTML_TAG = /<\/?[a-z][^>]*>/i;
const CHECKSUM = /^[a-f0-9]{64}$/i;
const MAX_TITLE = 70;
const MAX_DESCRIPTION = 160;

/**
 * Inventario y carga idempotente de contenido editorial.
 *
 * El DWH nunca recibe estos campos: este servicio solo actualiza las tres
 * columnas editoriales y exige que la evidencia de imagen siga vigente.
 */
@Injectable()
export class ProductContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async inventory(
    onlyActiveWithPrimaryImage = true,
  ): Promise<ProductContentInventoryItem[]> {
    const products = await this.prisma.product.findMany({
      where: onlyActiveWithPrimaryImage
        ? { active: true, images: { some: { isPrimary: true } } }
        : undefined,
      include: CONTENT_PRODUCT_INCLUDE,
      orderBy: [{ brand: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
    });

    return products.map((product) => ({
      productoKey: product.productoKey,
      sku: product.sku,
      name: product.name,
      active: product.active,
      brand: product.brand?.name ?? null,
      supplier: product.supplier.name,
      editorial: {
        longDescription: product.longDescription,
        seoTitle: product.seoTitle,
        seoDescription: product.seoDescription,
      },
      images: product.images.map((image) => ({
        position: image.position,
        isPrimary: image.isPrimary,
        sourceChecksum: image.sourceChecksum,
        fullUrl: image.fullUrl,
      })),
    }));
  }

  async import(
    input: unknown,
    options: ProductContentImportOptions,
  ): Promise<ProductContentImportSummary> {
    const records = extractRecords(input);
    const summary: ProductContentImportSummary = {
      mode: options.apply ? 'apply' : 'dry-run',
      total: records?.length ?? 0,
      valid: 0,
      applied: 0,
      unchanged: 0,
      preserved: 0,
      pending: 0,
      errors: [],
    };

    if (records === null) {
      summary.errors.push(
        'El archivo debe ser una lista o un objeto con `products`',
      );
      summary.pending = summary.errors.length;
      return summary;
    }

    const seen = new Set<string>();
    const prepared: ProductContentRecord[] = [];
    for (let index = 0; index < records.length; index += 1) {
      const raw = records[index];
      const recordError = validateRecord(raw, index, seen);
      if (recordError) {
        summary.errors.push(recordError);
        continue;
      }
      const record = raw as ProductContentRecord;
      seen.add(record.productoKey);

      const product = await this.prisma.product.findUnique({
        where: { productoKey: record.productoKey },
        include: CONTENT_PRODUCT_INCLUDE,
      });
      const productError = this.validateProduct(product, record, index);
      if (productError) {
        summary.errors.push(productError);
        continue;
      }
      const validatedProduct = product!;
      summary.valid += 1;
      if (!options.replace) {
        summary.preserved += [
          validatedProduct.longDescription,
          validatedProduct.seoTitle,
          validatedProduct.seoDescription,
        ].filter((value) => !isBlank(value)).length;
      }
      prepared.push(record);
    }

    // Primero se valida el archivo completo; un lote con errores nunca deja
    // una parte escrita y puede corregirse y repetirse de forma segura.
    summary.pending = summary.errors.length;
    if (!options.apply || summary.errors.length > 0) return summary;

    for (let index = 0; index < prepared.length; index += 1) {
      const record = prepared[index];

      const result = await this.prisma.$transaction(async (tx) => {
        // Relee dentro de la transacción: una imagen reemplazada entre la
        // validación y la escritura invalida el lote en vez de mezclar fuentes.
        const current = await tx.product.findUnique({
          where: { productoKey: record.productoKey },
          include: CONTENT_PRODUCT_INCLUDE,
        });
        const currentError = this.validateProduct(current, record, index);
        if (currentError) throw new Error(currentError);

        const data: Prisma.ProductUpdateInput = {};
        const fields: [
          keyof Pick<
            ProductContentRecord,
            'longDescription' | 'seoTitle' | 'seoDescription'
          >,
          keyof Pick<
            ProductContentSnapshot,
            'longDescription' | 'seoTitle' | 'seoDescription'
          >,
        ][] = [
          ['longDescription', 'longDescription'],
          ['seoTitle', 'seoTitle'],
          ['seoDescription', 'seoDescription'],
        ];
        for (const [incomingField, currentField] of fields) {
          if (options.replace || isBlank(current![currentField])) {
            data[currentField] = record[incomingField];
          }
        }

        if (Object.keys(data).length === 0) return false;
        await tx.product.update({
          where: { productoKey: record.productoKey },
          data,
        });
        return true;
      });

      if (result) summary.applied += 1;
      else summary.unchanged += 1;
    }

    if (summary.applied > 0) {
      await this.cache.invalidateByPrefix('http:');
    }
    return summary;
  }

  private validateProduct(
    product: ProductContentSnapshot | null,
    record: ProductContentRecord,
    index: number,
  ): string | null {
    if (!product)
      return `Registro ${index + 1}: productoKey no existe (${record.productoKey})`;
    if (!product.active)
      return `Registro ${index + 1}: producto inactivo (${record.productoKey})`;
    if (!product.images.some((image) => image.isPrimary)) {
      return `Registro ${index + 1}: el producto no tiene imagen primaria (${record.productoKey})`;
    }
    for (const evidence of record.evidence) {
      const image = product.images.find(
        (candidate) => candidate.position === evidence.position,
      );
      if (
        !image ||
        image.sourceChecksum.toLowerCase() !==
          evidence.sourceChecksum.toLowerCase()
      ) {
        return `Registro ${index + 1}: evidencia de imagen desactualizada (${record.productoKey}, posición ${evidence.position})`;
      }
    }
    return null;
  }
}

function extractRecords(input: unknown): unknown[] | null {
  if (Array.isArray(input)) return input as unknown[];
  if (
    typeof input === 'object' &&
    input !== null &&
    Array.isArray((input as { products?: unknown }).products)
  ) {
    return (input as { products: unknown[] }).products;
  }
  return null;
}

function validateRecord(
  value: unknown,
  index: number,
  seen: Set<string>,
): string | null {
  const prefix = `Registro ${index + 1}`;
  if (typeof value !== 'object' || value === null)
    return `${prefix}: debe ser un objeto`;
  const record = value as Partial<ProductContentRecord>;
  if (!nonEmpty(record.productoKey))
    return `${prefix}: productoKey es obligatorio`;
  if (seen.has(record.productoKey))
    return `${prefix}: productoKey duplicado (${record.productoKey})`;
  if (
    !nonEmpty(record.longDescription) ||
    record.longDescription.length < 80 ||
    record.longDescription.length > 1200
  ) {
    return `${prefix}: longDescription debe tener entre 80 y 1200 caracteres`;
  }
  if (!nonEmpty(record.seoTitle) || record.seoTitle.length > MAX_TITLE) {
    return `${prefix}: seoTitle debe tener entre 1 y ${MAX_TITLE} caracteres`;
  }
  if (
    !nonEmpty(record.seoDescription) ||
    record.seoDescription.length > MAX_DESCRIPTION
  ) {
    return `${prefix}: seoDescription debe tener entre 1 y ${MAX_DESCRIPTION} caracteres`;
  }
  if (
    HTML_TAG.test(record.longDescription) ||
    HTML_TAG.test(record.seoTitle) ||
    HTML_TAG.test(record.seoDescription)
  ) {
    return `${prefix}: el contenido debe ser texto plano, sin etiquetas HTML`;
  }
  if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
    return `${prefix}: evidence debe incluir al menos una imagen`;
  }
  for (const evidence of record.evidence) {
    if (typeof evidence !== 'object' || evidence === null) {
      return `${prefix}: evidence contiene una posición o checksum inválido`;
    }
    const evidenceRecord = evidence as {
      position?: unknown;
      sourceChecksum?: unknown;
    };
    if (
      !Number.isInteger(evidenceRecord.position) ||
      (evidenceRecord.position as number) < 0 ||
      typeof evidenceRecord.sourceChecksum !== 'string' ||
      !CHECKSUM.test(evidenceRecord.sourceChecksum)
    ) {
      return `${prefix}: evidence contiene una posición o checksum inválido`;
    }
  }
  return null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}
