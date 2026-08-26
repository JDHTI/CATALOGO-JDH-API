import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { RateLimitGuard } from '../guards/rate-limit.guard';
import { RATE_LIMITER } from './rate-limiter.interface';
import { RedisRateLimiterService } from './redis-rate-limiter.service';

/**
 * Registra el limitador de peticiones y lo aplica como guard global.
 * La implementación concreta (Redis) queda detrás del token `RATE_LIMITER`,
 * de modo que puede sustituirse sin tocar el guard.
 */
@Module({
  providers: [
    { provide: RATE_LIMITER, useClass: RedisRateLimiterService },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [RATE_LIMITER],
})
export class RateLimitModule {}
