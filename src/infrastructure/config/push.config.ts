import { registerAs } from '@nestjs/config';

/**
 * Publicación del catálogo local hacia otra instancia (Railway).
 *
 * Es una herramienta LOCAL: el DWH solo es alcanzable desde la red interna, así
 * que el equipo que corre el sync es el único que puede empujar el resultado
 * hacia la nube. La API desplegada nunca define estas variables y por eso
 * `enabled` es `false` allá.
 */
export interface PushConfig {
  /** `false` cuando no hay `PUSH_TARGET_DATABASE_URL`. */
  enabled: boolean;
  /** Cadena de conexión de la base DESTINO (la de Railway). */
  targetDatabaseUrl?: string;
  /** Tamaño de lote al recorrer productos e imágenes. */
  batchSize: number;
  connectionTimeoutMillis: number;
  statementTimeoutMillis: number;
}

export const PUSH_CONFIG = 'push';

export default registerAs<PushConfig>(PUSH_CONFIG, () => {
  const targetDatabaseUrl =
    process.env.PUSH_TARGET_DATABASE_URL?.trim() || undefined;

  return {
    enabled: targetDatabaseUrl !== undefined,
    targetDatabaseUrl,
    batchSize: Number(process.env.PUSH_BATCH_SIZE ?? 1_000),
    connectionTimeoutMillis: Number(
      process.env.PUSH_CONNECTION_TIMEOUT ?? 20_000,
    ),
    statementTimeoutMillis: Number(
      process.env.PUSH_STATEMENT_TIMEOUT ?? 120_000,
    ),
  };
});
