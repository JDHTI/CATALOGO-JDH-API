import { Injectable, Logger } from '@nestjs/common';

import { CacheService } from '@infrastructure/cache';
import { PrismaService } from '@infrastructure/database';
import { LogosService } from '@modules/logos/logos.service';

import {
  buildRuleIndex,
  classify,
  confidenceOf,
  isServiceItem,
  learnRules,
  signatureOf,
  type Confidence,
  type LearnedRule,
  type LearnSample,
  type ProductFeatures,
  type RuleIndex,
  type RuleKind,
} from './categorization.classifier';
import type { AssignmentRow, Taxonomy } from './categorization.data';

/** Tamaño de lote al recorrer productos o insertar filas. */
const BATCH_SIZE = 1000;
/** Actualizaciones por transacción cuando hay que reescribir filas sueltas. */
const UPDATE_CHUNK = 100;

/** Grupo al que van siempre los ítems tipo Servicio (ver `taxonomia.json`). */
const SERVICES = 'Servicios';

/** Jerarquía de un grupo, para derivar categoría y subcategoría de un grupo. */
interface GroupRef {
  groupId: number;
  subcategoryId: number;
  categoryId: number;
}

export interface CreatedExisting {
  created: number;
  existing: number;
}

export interface SeedSummary {
  categories: CreatedExisting;
  subcategories: CreatedExisting;
  groups: CreatedExisting;
}

export interface ImportSummary {
  /** Filas del archivo. */
  read: number;
  /** Asignaciones creadas. */
  created: number;
  /** El producto ya tenía asignación: no se toca. */
  alreadyAssigned: number;
  /** Productos del archivo que no existen (todavía) en el catálogo. */
  unknownProducts: number;
}

export interface LearnSummary {
  samples: number;
  rules: number;
  byKind: Record<RuleKind, number>;
}

export interface ReconcileSummary {
  /** Productos revisados (activos e inactivos). */
  read: number;
  /** Productos sin asignación que el clasificador pudo ubicar. */
  created: number;
  /** Asignaciones automáticas que cambiaron de grupo porque el ERP movió el producto. */
  reclassified: number;
  /** El ERP movió el producto y las reglas no resuelven: se conserva y se marca. */
  flagged: number;
  unchanged: number;
  /** Sin asignación al terminar (ninguna regla aplica). */
  pending: number;
  /** De los pendientes, los que hoy son visibles en el catálogo. */
  pendingActive: number;
}

export interface ManualAssignSummary {
  assigned: number;
  unknownKeys: string[];
}

export interface ReviewRow {
  productoKey: string;
  sku: string;
  name: string;
  active: boolean;
  linea: string | null;
  sublinea: string | null;
  grupo: string | null;
  proposed: string | null;
}

/** Producto tal como lo lee el clasificador, con su asignación actual. */
type ProductForReconcile = ProductFeatures & {
  id: number;
  productoKey: string;
  categorization: {
    id: number;
    groupId: number;
    locked: boolean;
    signature: string;
  } | null;
};

/**
 * Categorización de productos, independiente del sync del DWH.
 *
 * El sync escribe `products`; esto escribe `product_categorizations`. Se
 * encadenan en un solo sentido (el sync dispara `reconcile()` al terminar) y
 * nunca se pisan. Cada pieza es idempotente: repetirla no duplica ni cambia
 * nada que no hubiera cambiado. Ver docs/categorization.md.
 */
@Injectable()
export class CategorizationService {
  private readonly logger = new Logger(CategorizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  // ------------------------------------------------------------- taxonomía

  /**
   * Crea la taxonomía que falte. Solo crea: nunca renombra, reordena ni
   * reactiva lo que ya existe, para no pisar ajustes hechos después de la
   * carga inicial.
   */
  async seedTaxonomy(taxonomy: Taxonomy): Promise<SeedSummary> {
    const summary: SeedSummary = {
      categories: { created: 0, existing: 0 },
      subcategories: { created: 0, existing: 0 },
      groups: { created: 0, existing: 0 },
    };

    const categories = await this.prisma.category.findMany({
      include: { subcategories: { include: { groups: true } } },
    });
    const categoryByName = new Map(categories.map((row) => [row.name, row]));
    const takenCategorySlugs = new Set(categories.map((row) => row.slug));

    for (const category of taxonomy.categories) {
      let categoryRow = categoryByName.get(category.name);
      if (categoryRow) {
        summary.categories.existing += 1;
      } else {
        const created = await this.prisma.category.create({
          data: {
            name: category.name,
            slug: freeSlug(category.name, takenCategorySlugs, 'categoria'),
            sortOrder: category.sortOrder,
            active: category.active,
          },
        });
        categoryRow = { ...created, subcategories: [] };
        summary.categories.created += 1;
      }

      const subByName = new Map(
        categoryRow.subcategories.map((row) => [row.name, row]),
      );
      const takenSubSlugs = new Set(
        categoryRow.subcategories.map((row) => row.slug),
      );

      for (const subcategory of category.subcategories) {
        let subRow = subByName.get(subcategory.name);
        if (subRow) {
          summary.subcategories.existing += 1;
        } else {
          const created = await this.prisma.subcategory.create({
            data: {
              name: subcategory.name,
              slug: freeSlug(subcategory.name, takenSubSlugs, 'subcategoria'),
              categoryId: categoryRow.id,
              sortOrder: subcategory.sortOrder,
            },
          });
          subRow = { ...created, groups: [] };
          summary.subcategories.created += 1;
        }

        const groupNames = new Set(subRow.groups.map((row) => row.name));
        const takenGroupSlugs = new Set(subRow.groups.map((row) => row.slug));
        const toCreate = subcategory.groups.filter(
          (group) => !groupNames.has(group.name),
        );
        summary.groups.existing += subcategory.groups.length - toCreate.length;

        if (toCreate.length > 0) {
          await this.prisma.productGroup.createMany({
            data: toCreate.map((group) => ({
              name: group.name,
              slug: freeSlug(group.name, takenGroupSlugs, 'grupo'),
              subcategoryId: subRow.id,
              sortOrder: group.sortOrder,
            })),
            skipDuplicates: true,
          });
          summary.groups.created += toCreate.length;
        }
      }
    }

    if (
      summary.categories.created +
        summary.subcategories.created +
        summary.groups.created >
      0
    ) {
      await this.cache.invalidateByPrefix('http:');
    }
    return summary;
  }

  /**
   * Código de grupo del archivo de asignaciones → grupo de la base, resuelto
   * por nombre (categoría › subcategoría › grupo). Falla si falta alguno: la
   * taxonomía se carga primero con `seedTaxonomy`.
   */
  async resolveGroupCodes(taxonomy: Taxonomy): Promise<Map<string, GroupRef>> {
    const categories = await this.prisma.category.findMany({
      select: {
        id: true,
        name: true,
        subcategories: {
          select: {
            id: true,
            name: true,
            groups: { select: { id: true, name: true } },
          },
        },
      },
    });

    const codes = new Map<string, GroupRef>();
    for (const category of taxonomy.categories) {
      const categoryRow = categories.find((row) => row.name === category.name);
      for (const subcategory of category.subcategories) {
        const subRow = categoryRow?.subcategories.find(
          (row) => row.name === subcategory.name,
        );
        for (const group of subcategory.groups) {
          const groupRow = subRow?.groups.find(
            (row) => row.name === group.name,
          );
          if (!categoryRow || !subRow || !groupRow) {
            throw new Error(
              `La taxonomía no está cargada: falta ${category.name} › ` +
                `${subcategory.name} › ${group.name}. Corre "categorization seed".`,
            );
          }
          codes.set(group.code, {
            groupId: groupRow.id,
            subcategoryId: subRow.id,
            categoryId: categoryRow.id,
          });
        }
      }
    }
    return codes;
  }

  // ----------------------------------------------------- carga inicial

  /**
   * Crea las asignaciones de un archivo revisado (la propuesta de
   * categorización) para los productos que aún no tienen una. Es idempotente y
   * nunca sobrescribe una asignación existente, venga de donde venga.
   */
  async importAssignments(
    rows: readonly AssignmentRow[],
    codes: ReadonlyMap<string, GroupRef>,
  ): Promise<ImportSummary> {
    const unknownCode = rows.find((row) => !codes.has(row.groupCode));
    if (unknownCode) {
      throw new Error(
        `Código de grupo desconocido "${unknownCode.groupCode}" ` +
          `(producto ${unknownCode.productoKey}).`,
      );
    }

    const summary: ImportSummary = {
      read: rows.length,
      created: 0,
      alreadyAssigned: 0,
      unknownProducts: 0,
    };

    for (let start = 0; start < rows.length; start += BATCH_SIZE * 2) {
      const chunk = rows.slice(start, start + BATCH_SIZE * 2);
      const products = await this.prisma.product.findMany({
        where: { productoKey: { in: chunk.map((row) => row.productoKey) } },
        select: {
          productoKey: true,
          name: true,
          linea: true,
          sublinea: true,
          grupo: true,
          tipoItem: true,
          categorization: { select: { id: true } },
        },
      });
      const byKey = new Map(products.map((row) => [row.productoKey, row]));

      const data = [];
      for (const row of chunk) {
        const product = byKey.get(row.productoKey);
        if (!product) {
          summary.unknownProducts += 1;
        } else if (product.categorization) {
          summary.alreadyAssigned += 1;
        } else {
          const ref = codes.get(row.groupCode)!;
          data.push({
            productoKey: row.productoKey,
            categoryId: ref.categoryId,
            subcategoryId: ref.subcategoryId,
            groupId: ref.groupId,
            source: 'propuesta',
            confidence: row.confidence,
            // Lo que el revisor marcó como dudoso sigue pendiente de revisión.
            needsReview: row.confidence === 'baja',
            signature: signatureOf(product),
          });
        }
      }

      if (data.length > 0) {
        const { count } = await this.prisma.productCategorization.createMany({
          data,
          skipDuplicates: true,
        });
        summary.created += count;
      }
    }

    if (summary.created > 0) await this.cache.invalidateByPrefix('http:');
    return summary;
  }

  // --------------------------------------------------------------- reglas

  /**
   * Reaprende las reglas del clasificador desde las asignaciones revisadas
   * (`propuesta` y `manual`, sin las de confianza baja). Nunca entrena con sus
   * propias asignaciones (`regla`): se retroalimentaría. Reemplaza todas las
   * reglas.
   */
  async learn(): Promise<LearnSummary> {
    const samples: LearnSample[] = [];
    let cursor = 0;

    for (;;) {
      const batch = await this.prisma.productCategorization.findMany({
        where: {
          id: { gt: cursor },
          source: { in: ['propuesta', 'manual'] },
          confidence: { not: 'baja' },
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE * 5,
        select: {
          id: true,
          groupId: true,
          product: {
            select: {
              name: true,
              linea: true,
              sublinea: true,
              grupo: true,
              tipoItem: true,
            },
          },
        },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].id;
      for (const row of batch) {
        samples.push({ product: row.product, groupId: row.groupId });
      }
    }

    const rules = learnRules(samples);
    await this.replaceRules(rules);

    const byKind: Record<RuleKind, number> = { lsg_w: 0, lsg: 0, g_w: 0, w: 0 };
    for (const rule of rules) byKind[rule.kind] += 1;
    return { samples: samples.length, rules: rules.length, byKind };
  }

  private async replaceRules(rules: readonly LearnedRule[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.categorizationRule.deleteMany();
      for (let start = 0; start < rules.length; start += BATCH_SIZE * 5) {
        await tx.categorizationRule.createMany({
          data: rules.slice(start, start + BATCH_SIZE * 5),
        });
      }
    });
  }

  private async loadRuleIndex(): Promise<RuleIndex> {
    const rows = await this.prisma.categorizationRule.findMany();
    return buildRuleIndex(
      rows.map((row) => ({
        kind: row.kind as RuleKind,
        ruleKey: row.ruleKey,
        groupId: row.groupId,
        support: row.support,
        purity: Number(row.purity),
      })),
    );
  }

  // ----------------------------------------------------------- reconcile

  /**
   * Pone la categorización al día con el catálogo. Corre solo después de cada
   * sync, y se puede lanzar a mano.
   *
   * - Producto sin asignación → se clasifica con las reglas; si ninguna
   *   acierta queda pendiente (sin fila), nunca con una categoría inventada.
   * - Producto cuya clasificación en el ERP cambió → se reevalúa su asignación
   *   AUTOMÁTICA. Si las reglas no resuelven, se conserva y se marca
   *   `needsReview`.
   * - Asignación manual (`locked`) → no se toca jamás.
   * - Productos inactivos: se procesan igual, para que al reactivarse ya estén
   *   categorizados.
   */
  async reconcile(): Promise<ReconcileSummary> {
    const [rules, groups, serviceGroupId] = await Promise.all([
      this.loadRuleIndex(),
      this.loadGroupIndex(),
      this.findServiceGroupId(),
    ]);

    const summary: ReconcileSummary = {
      read: 0,
      created: 0,
      reclassified: 0,
      flagged: 0,
      unchanged: 0,
      pending: 0,
      pendingActive: 0,
    };

    const decide = (
      product: ProductFeatures,
    ): { groupId: number; confidence: Confidence } | null => {
      if (serviceGroupId !== null && isServiceItem(product)) {
        return { groupId: serviceGroupId, confidence: 'alta' };
      }
      const hit = classify(product, rules);
      return hit
        ? { groupId: hit.groupId, confidence: confidenceOf(hit) }
        : null;
    };

    let cursor = 0;
    for (;;) {
      const batch: ProductForReconcile[] = await this.prisma.product.findMany({
        where: { id: { gt: cursor } },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: {
          id: true,
          productoKey: true,
          name: true,
          linea: true,
          sublinea: true,
          grupo: true,
          tipoItem: true,
          categorization: {
            select: { id: true, groupId: true, locked: true, signature: true },
          },
        },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].id;
      summary.read += batch.length;

      const toCreate = [];
      const toUpdate: {
        id: number;
        data: Record<string, string | number | boolean>;
      }[] = [];

      for (const product of batch) {
        const current = product.categorization;
        const signature = signatureOf(product);

        if (!current) {
          const decision = decide(product);
          const ref = decision ? groups.get(decision.groupId) : undefined;
          if (!decision || !ref) continue; // pendiente
          toCreate.push({
            productoKey: product.productoKey,
            categoryId: ref.categoryId,
            subcategoryId: ref.subcategoryId,
            groupId: ref.groupId,
            source: 'regla',
            confidence: decision.confidence,
            needsReview: decision.confidence !== 'alta',
            signature,
          });
          continue;
        }

        if (current.locked || current.signature === signature) {
          summary.unchanged += 1;
          continue;
        }

        const decision = decide(product);
        if (!decision) {
          toUpdate.push({
            id: current.id,
            data: { needsReview: true, signature },
          });
          summary.flagged += 1;
        } else if (decision.groupId === current.groupId) {
          toUpdate.push({ id: current.id, data: { signature } });
          summary.unchanged += 1;
        } else {
          const ref = groups.get(decision.groupId);
          if (!ref) continue;
          toUpdate.push({
            id: current.id,
            data: {
              categoryId: ref.categoryId,
              subcategoryId: ref.subcategoryId,
              groupId: ref.groupId,
              source: 'regla',
              confidence: decision.confidence,
              needsReview: decision.confidence !== 'alta',
              signature,
            },
          });
          summary.reclassified += 1;
        }
      }

      if (toCreate.length > 0) {
        const { count } = await this.prisma.productCategorization.createMany({
          data: toCreate,
          skipDuplicates: true,
        });
        summary.created += count;
      }
      for (let start = 0; start < toUpdate.length; start += UPDATE_CHUNK) {
        await this.prisma.$transaction(
          toUpdate
            .slice(start, start + UPDATE_CHUNK)
            .map(({ id, data }) =>
              this.prisma.productCategorization.update({ where: { id }, data }),
            ),
        );
      }
    }

    [summary.pending, summary.pendingActive] = await Promise.all([
      this.prisma.product.count({ where: { categorization: { is: null } } }),
      this.prisma.product.count({
        where: { categorization: { is: null }, active: true },
      }),
    ]);

    if (summary.created + summary.reclassified > 0) {
      await this.cache.invalidateByPrefix('http:');
    }
    this.logger.log(
      `Categorización al día: ${summary.read} productos, ${summary.created} ` +
        `nuevos, ${summary.reclassified} reclasificados, ${summary.flagged} ` +
        `por revisar, ${summary.pending} pendientes (${summary.pendingActive} activos)`,
    );
    return summary;
  }

  // ------------------------------------------------------ intervención manual

  /**
   * Asigna productos a un grupo a mano. La asignación queda BLOQUEADA: el
   * clasificador no la volverá a tocar aunque el ERP cambie el producto.
   */
  async assignManual(
    productoKeys: readonly string[],
    groupId: number,
  ): Promise<ManualAssignSummary> {
    const group = await this.prisma.productGroup.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        subcategoryId: true,
        subcategory: { select: { categoryId: true } },
      },
    });
    if (!group) throw new Error(`No existe el grupo ${groupId}.`);

    const products = await this.prisma.product.findMany({
      where: { productoKey: { in: [...productoKeys] } },
      select: {
        productoKey: true,
        name: true,
        linea: true,
        sublinea: true,
        grupo: true,
        tipoItem: true,
      },
    });
    const known = new Set(products.map((row) => row.productoKey));

    for (let start = 0; start < products.length; start += UPDATE_CHUNK) {
      await this.prisma.$transaction(
        products.slice(start, start + UPDATE_CHUNK).map((product) => {
          const data = {
            categoryId: group.subcategory.categoryId,
            subcategoryId: group.subcategoryId,
            groupId: group.id,
            source: 'manual',
            confidence: 'alta',
            locked: true,
            needsReview: false,
            signature: signatureOf(product),
          };
          return this.prisma.productCategorization.upsert({
            where: { productoKey: product.productoKey },
            create: { productoKey: product.productoKey, ...data },
            update: data,
          });
        }),
      );
    }

    if (products.length > 0) await this.cache.invalidateByPrefix('http:');
    return {
      assigned: products.length,
      unknownKeys: productoKeys.filter((key) => !known.has(key)),
    };
  }

  // ------------------------------------------------------------- revisión

  /** Productos sin asignación (`pending`) o marcados para revisar (`review`). */
  async listForReview(
    kind: 'pending' | 'review',
    options: { onlyActive?: boolean; limit?: number } = {},
  ): Promise<ReviewRow[]> {
    const products = await this.prisma.product.findMany({
      where: {
        ...(options.onlyActive ? { active: true } : {}),
        categorization:
          kind === 'pending' ? { is: null } : { is: { needsReview: true } },
      },
      orderBy: { id: 'asc' },
      take: options.limit,
      select: {
        productoKey: true,
        sku: true,
        name: true,
        active: true,
        linea: true,
        sublinea: true,
        grupo: true,
        categorization: {
          select: {
            group: {
              select: {
                name: true,
                subcategory: {
                  select: { name: true, category: { select: { name: true } } },
                },
              },
            },
          },
        },
      },
    });

    return products.map((product) => {
      const group = product.categorization?.group;
      return {
        productoKey: product.productoKey,
        sku: product.sku,
        name: product.name,
        active: product.active,
        linea: product.linea,
        sublinea: product.sublinea,
        grupo: product.grupo,
        proposed: group
          ? `${group.subcategory.category.name} › ${group.subcategory.name} › ${group.name}`
          : null,
      };
    });
  }

  // ------------------------------------------------------------- internos

  private async loadGroupIndex(): Promise<Map<number, GroupRef>> {
    const groups = await this.prisma.productGroup.findMany({
      select: {
        id: true,
        subcategoryId: true,
        subcategory: { select: { categoryId: true } },
      },
    });
    return new Map(
      groups.map((group) => [
        group.id,
        {
          groupId: group.id,
          subcategoryId: group.subcategoryId,
          categoryId: group.subcategory.categoryId,
        },
      ]),
    );
  }

  private async findServiceGroupId(): Promise<number | null> {
    const group = await this.prisma.productGroup.findFirst({
      where: {
        name: SERVICES,
        subcategory: { name: SERVICES, category: { name: SERVICES } },
      },
      select: { id: true },
    });
    return group?.id ?? null;
  }
}

/** Slug libre dentro de `taken` (que se actualiza), con sufijo si choca. */
function freeSlug(name: string, taken: Set<string>, fallback: string): string {
  const base = LogosService.slug(name) || fallback;
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}
