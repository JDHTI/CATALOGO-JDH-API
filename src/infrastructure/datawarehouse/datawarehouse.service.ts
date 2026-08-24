import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import {
  DATAWAREHOUSE_CONFIG,
  type DatawarehouseConfig,
} from '@infrastructure/config';

/**
 * Conexión independiente al Datawarehouse.
 *
 * Deliberadamente separada de Prisma: el DWH es un origen externo del que solo
 * se leen datos para sincronizarlos hacia el catálogo. No se versiona su schema
 * ni se ejecutan migraciones sobre él.
 */
@Injectable()
export class DatawarehouseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatawarehouseService.name);
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(config: ConfigService) {
    const dwh = config.getOrThrow<DatawarehouseConfig>(DATAWAREHOUSE_CONFIG);
    this.schema = dwh.schema;

    this.pool = new Pool({
      host: dwh.host,
      port: dwh.port,
      database: dwh.database,
      user: dwh.user,
      password: dwh.password,
      ssl: dwh.ssl ? { rejectUnauthorized: false } : undefined,
      max: dwh.poolMax,
      idleTimeoutMillis: dwh.idleTimeoutMillis,
      connectionTimeoutMillis: dwh.connectionTimeoutMillis,
      statement_timeout: dwh.statementTimeoutMillis,
      options: `-c search_path=${dwh.schema}`,
      application_name: 'jdh-catalogo-api',
    });

    this.pool.on('error', (error) =>
      this.logger.error(`Error en el pool del datawarehouse: ${error.message}`),
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.query('SELECT 1');
      this.logger.log(
        `Conexión establecida con el datawarehouse (schema: ${this.schema})`,
      );
    } catch (error) {
      // No se aborta el arranque: el catálogo debe poder servir sin el DWH.
      this.logger.warn(
        `Datawarehouse no disponible al iniciar: ${(error as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /** Ejecuta un SELECT parametrizado y devuelve las filas tipadas. */
  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const started = Date.now();
    const result = await this.pool.query<T>(sql, params as unknown[]);
    this.logger.debug(
      `Consulta DWH ejecutada en ${Date.now() - started}ms (${result.rowCount} filas)`,
    );
    return result.rows;
  }

  /** Igual que `query`, pero devuelve la primera fila o `null`. */
  async queryOne<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T | null> {
    const [row] = await this.query<T>(sql, params);
    return row ?? null;
  }

  /**
   * Recorre un resultado grande en lotes, sin cargarlo completo en memoria.
   * Útil para las sincronizaciones incrementales del catálogo.
   */
  async *stream<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
    batchSize = 1_000,
  ): AsyncGenerator<T[]> {
    let offset = 0;

    for (;;) {
      const rows = await this.query<T>(
        `SELECT * FROM (${sql}) AS source LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, batchSize, offset],
      );
      if (rows.length === 0) return;

      yield rows;
      if (rows.length < batchSize) return;
      offset += batchSize;
    }
  }

  /** Toma un cliente dedicado del pool (por ejemplo, para cursores o sesiones). */
  async withClient<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await handler(client);
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    await this.query('SELECT 1');
    return true;
  }
}
