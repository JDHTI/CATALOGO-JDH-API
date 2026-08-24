import { registerAs } from '@nestjs/config';

/**
 * Conexión independiente al Datawarehouse (Postgres externo).
 * Se usa solo para lectura/sincronización de datos hacia el catálogo, así que
 * es opcional: sin `DWH_HOST` la conexión queda deshabilitada y la API arranca
 * igual.
 */
export interface DatawarehouseConfig {
  /** `false` cuando no hay `DWH_HOST` definido. */
  enabled: boolean;
  host?: string;
  port: number;
  database?: string;
  user?: string;
  password?: string;
  schema: string;
  ssl: boolean;
  poolMax: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statementTimeoutMillis: number;
}

export const DATAWAREHOUSE_CONFIG = 'datawarehouse';

export default registerAs<DatawarehouseConfig>(DATAWAREHOUSE_CONFIG, () => {
  const host = process.env.DWH_HOST?.trim() || undefined;

  return {
    enabled: host !== undefined,
    host,
    port: Number(process.env.DWH_PORT ?? 5432),
    database: process.env.DWH_DATABASE?.trim() || undefined,
    user: process.env.DWH_USER?.trim() || undefined,
    password: process.env.DWH_PASSWORD || undefined,
    schema: process.env.DWH_SCHEMA?.trim() || 'public',
    ssl: process.env.DWH_SSL === 'true',
    poolMax: Number(process.env.DWH_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.DWH_POOL_IDLE_TIMEOUT ?? 30_000),
    connectionTimeoutMillis: Number(
      process.env.DWH_CONNECTION_TIMEOUT ?? 10_000,
    ),
    statementTimeoutMillis: Number(process.env.DWH_STATEMENT_TIMEOUT ?? 60_000),
  };
});
