import { SetMetadata, type CustomDecorator } from '@nestjs/common';

import type { RateLimitWindow } from '../ratelimit/rate-limiter.interface';

/** Clave de metadatos con la cuota propia de un handler o controlador. */
export const RATE_LIMIT_METADATA = 'ratelimit:route';

/** Cuota propia de una ruta, con nombre para separar su contador en Redis. */
export interface RouteRateLimit extends RateLimitWindow {
  /** Prefijo del contador (`ratelimit:<name>:<ip>`). Único por ruta. */
  name: string;
}

/**
 * Cuota adicional por IP para una ruta sensible (p. ej. un formulario
 * público). La cuota global sigue aplicando: la petición pasa solo si
 * cabe en las dos.
 */
export const RateLimit = (limit: RouteRateLimit): CustomDecorator =>
  SetMetadata(RATE_LIMIT_METADATA, limit);
