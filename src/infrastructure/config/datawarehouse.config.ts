import { registerAs } from '@nestjs/config';

/**
 * Conexión independiente al Datawarehouse (Postgres externo).
 * Se usa solo para lectura/sincronización de datos hacia el catálogo.
 */
export interface DatawarehouseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema: string;
  ssl: boolean;
  poolMax: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statementTimeoutMillis: number;
}

export const DATAWAREHOUSE_CONFIG = 'datawarehouse';

export default registerAs<DatawarehouseConfig>(DATAWAREHOUSE_CONFIG, () => ({
  host: process.env.DWH_HOST as string,
  port: Number(process.env.DWH_PORT ?? 5432),
  database: process.env.DWH_DATABASE as string,
  user: process.env.DWH_USER as string,
  password: process.env.DWH_PASSWORD ?? '',
  schema: process.env.DWH_SCHEMA ?? 'public',
  ssl: process.env.DWH_SSL === 'true',
  poolMax: Number(process.env.DWH_POOL_MAX ?? 10),
  idleTimeoutMillis: Number(process.env.DWH_POOL_IDLE_TIMEOUT ?? 30_000),
  connectionTimeoutMillis: Number(process.env.DWH_CONNECTION_TIMEOUT ?? 10_000),
  statementTimeoutMillis: Number(process.env.DWH_STATEMENT_TIMEOUT ?? 60_000),
}));
