import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CacheService } from '@infrastructure/cache';
import {
  RATE_LIMIT_CONFIG,
  type RateLimitConfig,
} from '@infrastructure/config';

import type { RateLimiter, RateLimitResult } from './rate-limiter.interface';

/**
 * Script Lua de ventana fija: INCR + EXPIRE en una sola operación atómica.
 * Devuelve `[contador, ttlRestante]` para la clave de la ventana.
 */
const FIXED_WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { current, ttl }
`;

/**
 * Limitador de peticiones de ventana fija sobre Redis.
 * Reutiliza la conexión del CacheService (no abre conexiones nuevas) y
 * FALLA ABIERTO: si Redis no está disponible, la petición se permite y solo
 * se deja constancia en el log. El rate limiting es una defensa, no puede
 * convertirse en un punto único de fallo de la API.
 */
@Injectable()
export class RedisRateLimiterService implements RateLimiter {
  private readonly logger = new Logger(RedisRateLimiterService.name);
  private readonly ttl: number;
  private readonly max: number;

  constructor(
    private readonly cache: CacheService,
    config: ConfigService,
  ) {
    const rateLimit = config.getOrThrow<RateLimitConfig>(RATE_LIMIT_CONFIG);
    this.ttl = rateLimit.ttl;
    this.max = rateLimit.max;
  }

  async consume(key: string): Promise<RateLimitResult> {
    try {
      // ioredis aplica el keyPrefix configurado también a las KEYS de EVAL.
      const [count, ttlRemaining] = (await this.cache.raw.eval(
        FIXED_WINDOW_SCRIPT,
        1,
        `ratelimit:${key}`,
        this.ttl,
      )) as [number, number];

      return {
        allowed: count <= this.max,
        limit: this.max,
        remaining: Math.max(this.max - count, 0),
        resetSeconds: ttlRemaining,
      };
    } catch (error) {
      // Fallo abierto: sin Redis no limitamos, pero la API sigue en pie.
      this.logger.warn(
        `Rate limiter sin Redis, se permite la petición ("${key}"): ${(error as Error).message}`,
      );
      return {
        allowed: true,
        limit: this.max,
        remaining: this.max,
        resetSeconds: 0,
      };
    }
  }
}
