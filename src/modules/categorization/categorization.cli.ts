/**
 * Operación de la categorización desde la terminal:
 *
 *   pnpm categorization bootstrap        # carga inicial completa (ver abajo)
 *   pnpm categorization seed             # crea la taxonomía que falte
 *   pnpm categorization import           # asignaciones de la propuesta revisada
 *   pnpm categorization learn            # reaprende las reglas
 *   pnpm categorization reconcile        # clasifica lo nuevo y reevalúa lo movido
 *   pnpm categorization review [--kind pending|review] [--active] [--limit N] [--out archivo.csv]
 *   pnpm categorization assign --group <id> <productoKey> [...]
 *
 * `bootstrap` = seed + import + learn + reconcile. Todo es idempotente: se
 * puede repetir sin duplicar ni pisar asignaciones existentes. Después de la
 * carga inicial, `reconcile` corre solo al final de cada `sync:products`.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import {
  CATEGORIZATION_DATA_DIR,
  loadAssignments,
  loadTaxonomy,
} from './categorization.data';
import {
  CategorizationService,
  type ReviewRow,
} from './categorization.service';

const DEFAULT_TAXONOMY = join(CATEGORIZATION_DATA_DIR, 'taxonomia.json');
const DEFAULT_ASSIGNMENTS = join(
  CATEGORIZATION_DATA_DIR,
  'asignaciones-v3.csv',
);

function csvCell(value: string | number | boolean | null): string {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: readonly ReviewRow[]): string {
  const header = [
    'producto_key',
    'sku',
    'nombre',
    'activo',
    'linea',
    'sublinea',
    'grupo_erp',
    'ubicacion_actual',
  ];
  const lines = rows.map((row) =>
    [
      row.productoKey,
      row.sku,
      row.name,
      row.active,
      row.linea,
      row.sublinea,
      row.grupo,
      row.proposed,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n') + '\n';
}

async function main(): Promise<void> {
  const logger = new Logger('CategorizationCli');
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      taxonomy: { type: 'string', default: DEFAULT_TAXONOMY },
      assignments: { type: 'string', default: DEFAULT_ASSIGNMENTS },
      kind: { type: 'string', default: 'pending' },
      active: { type: 'boolean', default: false },
      limit: { type: 'string' },
      out: { type: 'string' },
      group: { type: 'string' },
    },
  });
  const [command, ...rest] = positionals;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const categorization = app.get(CategorizationService);

    const seed = async (): Promise<void> => {
      const summary = await categorization.seedTaxonomy(
        loadTaxonomy(values.taxonomy),
      );
      logger.log(`Taxonomía: ${JSON.stringify(summary)}`);
    };
    const importAssignments = async (): Promise<void> => {
      const taxonomy = loadTaxonomy(values.taxonomy);
      const summary = await categorization.importAssignments(
        loadAssignments(values.assignments),
        await categorization.resolveGroupCodes(taxonomy),
      );
      logger.log(`Asignaciones importadas: ${JSON.stringify(summary)}`);
    };
    const learn = async (): Promise<void> => {
      logger.log(`Reglas: ${JSON.stringify(await categorization.learn())}`);
    };
    const reconcile = async (): Promise<void> => {
      logger.log(
        `Reconciliación: ${JSON.stringify(await categorization.reconcile())}`,
      );
    };

    switch (command) {
      case 'seed':
        await seed();
        break;
      case 'import':
        await importAssignments();
        break;
      case 'learn':
        await learn();
        break;
      case 'reconcile':
        await reconcile();
        break;
      case 'bootstrap':
        await seed();
        await importAssignments();
        await learn();
        await reconcile();
        break;
      case 'review': {
        const kind = values.kind === 'review' ? 'review' : 'pending';
        const rows = await categorization.listForReview(kind, {
          onlyActive: values.active,
          limit: values.limit ? Number(values.limit) : undefined,
        });
        if (values.out) {
          writeFileSync(values.out, '﻿' + toCsv(rows), 'utf8');
          logger.log(`${rows.length} productos (${kind}) → ${values.out}`);
        } else {
          for (const row of rows.slice(0, 50)) {
            logger.log(
              `${row.sku} | ${row.name} | ${row.linea}/${row.sublinea}/${row.grupo}`,
            );
          }
          logger.log(`${rows.length} productos (${kind})`);
        }
        break;
      }
      case 'assign': {
        const groupId = Number(values.group);
        if (!Number.isInteger(groupId) || rest.length === 0) {
          throw new Error(
            'Uso: categorization assign --group <id> <productoKey> [...]',
          );
        }
        const summary = await categorization.assignManual(rest, groupId);
        logger.log(`Asignación manual: ${JSON.stringify(summary)}`);
        break;
      }
      default:
        throw new Error(
          'Comando desconocido. Usa: bootstrap | seed | import | learn | ' +
            'reconcile | review | assign',
        );
    }
  } catch (error) {
    logger.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
