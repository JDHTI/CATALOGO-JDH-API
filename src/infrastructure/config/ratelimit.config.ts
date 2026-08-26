import { registerAs } from '@nestjs/config';

export interface RateLimitConfig {
  /** Tamaño de la ventana, en segundos. */
  ttl: number;
  /** Máximo de peticiones permitidas por IP dentro de la ventana. */
  max: number;
}

export const RATE_LIMIT_CONFIG = 'ratelimit';

export default registerAs<RateLimitConfig>(RATE_LIMIT_CONFIG, () => ({
  ttl: Number(process.env.RATE_LIMIT_TTL ?? 60),
  max: Number(process.env.RATE_LIMIT_MAX ?? 100),
}));
