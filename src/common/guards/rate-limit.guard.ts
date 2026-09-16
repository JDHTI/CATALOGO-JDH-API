import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  RATE_LIMITER,
  type RateLimiter,
} from '../ratelimit/rate-limiter.interface';

/**
 * Guard global de rate limiting por IP.
 * Añade los headers estándar `X-RateLimit-*` a toda respuesta y responde
 * 429 (con `Retry-After`) cuando la IP agota su cuota de la ventana.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    if (Reflect.getMetadata('health:probe', context.getHandler())) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    const result = await this.rateLimiter.consume(ip);

    response.setHeader('X-RateLimit-Limit', result.limit);
    response.setHeader('X-RateLimit-Remaining', result.remaining);
    response.setHeader('X-RateLimit-Reset', result.resetSeconds);

    if (!result.allowed) {
      response.setHeader('Retry-After', result.resetSeconds);
      throw new HttpException(
        `Demasiadas peticiones. Inténtalo de nuevo en ${result.resetSeconds} segundos.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
