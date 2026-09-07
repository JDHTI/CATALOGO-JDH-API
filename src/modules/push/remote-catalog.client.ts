import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@prisma-client';
import type { PushConfig } from '@infrastructure/config';

/**
 * Cliente Prisma apuntando a la base DESTINO (la de Railway).
 *
 * Deliberadamente NO es un provider de Nest: se abre y se cierra dentro de una
 * corrida de `pnpm push:catalogo` y no debe existir en ningún otro contexto
 * —mucho menos en la API desplegada, que no tiene por qué conocer ninguna otra
 * base—. Usa el mismo esquema Prisma que la base local, así que la
 * comparación campo a campo es exacta por construcción.
 */
export function createRemoteCatalogClient(config: PushConfig): PrismaClient {
  if (!config.targetDatabaseUrl) {
    throw new Error(
      'No hay base destino configurada: define PUSH_TARGET_DATABASE_URL en el .env local.',
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: config.targetDatabaseUrl,
      // El destino está al otro lado de internet (proxy TCP de Railway), no en
      // localhost: los timeouts por defecto de `pg` se quedan cortos.
      connectionTimeoutMillis: config.connectionTimeoutMillis,
      statement_timeout: config.statementTimeoutMillis,
      // Una sola conexión: el push es estrictamente secuencial y así no se
      // abren sesiones de más contra la base de la nube.
      max: 1,
      application_name: 'jdh-catalogo-push',
    }),
    log: ['warn', 'error'],
  });
}

/**
 * Impide empujar una base sobre sí misma.
 *
 * El accidente es fácil: basta copiar el `.env` de un lado al otro y dejar
 * `PUSH_TARGET_DATABASE_URL` igual a `DATABASE_URL`. El push se volvería un
 * bucle que reescribe la fuente con sus propios datos.
 */
export function assertDistinctDatabases(
  localUrl: string,
  targetUrl: string,
): void {
  const identity = (raw: string): string | null => {
    try {
      const url = new URL(raw);
      return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
    } catch {
      // Cadena no parseable: se compara cruda más abajo.
      return null;
    }
  };

  const local = identity(localUrl);
  const target = identity(targetUrl);
  const same =
    local !== null && target !== null
      ? local === target
      : localUrl === targetUrl;

  if (same) {
    throw new Error(
      'PUSH_TARGET_DATABASE_URL apunta a la MISMA base que DATABASE_URL. ' +
        'El destino debe ser la base de Railway, no la local.',
    );
  }
}
