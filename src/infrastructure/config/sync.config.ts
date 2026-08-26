import { registerAs } from '@nestjs/config';

/** Configuración de las sincronizaciones desde el datawarehouse. */
export interface SyncConfig {
  /** Expresión cron de la sincronización de productos. */
  productsCron: string;
  /** Permite apagar la sincronización programada sin quitar el cron. */
  productsEnabled: boolean;
}

export const SYNC_CONFIG = 'sync';

/** Cron por defecto: todos los días a las 02:00. */
export const SYNC_PRODUCTS_CRON_DEFAULT = '0 2 * * *';

export default registerAs<SyncConfig>(SYNC_CONFIG, () => ({
  productsCron:
    process.env.SYNC_PRODUCTS_CRON?.trim() || SYNC_PRODUCTS_CRON_DEFAULT,
  productsEnabled: process.env.SYNC_PRODUCTS_ENABLED !== 'false',
}));
