import { registerAs } from '@nestjs/config';

/** Base de datos propia del catálogo, gestionada por Prisma. */
export interface DatabaseConfig {
  url: string;
  logQueries: boolean;
}

export const DATABASE_CONFIG = 'database';

export default registerAs<DatabaseConfig>(DATABASE_CONFIG, () => ({
  url: process.env.DATABASE_URL as string,
  logQueries: process.env.DATABASE_LOG_QUERIES === 'true',
}));
