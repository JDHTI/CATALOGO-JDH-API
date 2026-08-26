import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/** Clave de metadatos con el TTL (segundos) de la caché HTTP. */
export const CACHE_TTL_METADATA = 'http-cache:ttl';

/** Clave de metadatos que excluye un handler/controlador de la caché HTTP. */
export const NO_CACHE_METADATA = 'http-cache:disabled';

/**
 * Sobrescribe el TTL de la caché HTTP para un handler o controlador.
 * Sin este decorador se usa `REDIS_DEFAULT_TTL`.
 */
export const CacheTTL = (seconds: number): CustomDecorator =>
  SetMetadata(CACHE_TTL_METADATA, seconds);

/** Excluye un handler o controlador de la caché HTTP. */
export const NoCache = (): CustomDecorator =>
  SetMetadata(NO_CACHE_METADATA, true);
