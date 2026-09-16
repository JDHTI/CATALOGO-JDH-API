import { registerAs } from '@nestjs/config';

/** Base de datos propia del catálogo, gestionada por Prisma. */
export interface DatabaseConfig {
  url: string;
  logQueries: boolean;
  poolMax: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  statementTimeoutMillis: number;
}

export const DATABASE_CONFIG = 'database';

export default registerAs<DatabaseConfig>(DATABASE_CONFIG, () => ({
  url: process.env.DATABASE_URL as string,
  logQueries: process.env.DATABASE_LOG_QUERIES === 'true',
  poolMax: Number(process.env.DATABASE_POOL_MAX || 20),
  connectionTimeoutMillis: Number(
    process.env.DATABASE_CONNECTION_TIMEOUT || 2000,
  ),
  idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT || 30000),
  statementTimeoutMillis: Number(
    process.env.DATABASE_STATEMENT_TIMEOUT || 5000,
  ),
}));
