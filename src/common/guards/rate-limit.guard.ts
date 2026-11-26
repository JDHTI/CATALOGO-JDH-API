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
  RATE_LIMIT_METADATA,
  type RouteRateLimit,
} from '../decorators/rate-limit.decorator';
import {
  RATE_LIMITER,
  type RateLimiter,
} from '../ratelimit/rate-limiter.interface';

/**
 * Guard global de rate limiting por IP.
 * Añade los headers estándar `X-RateLimit-*` a toda respuesta y responde
 * 429 (con `Retry-After`) cuando la IP agota su cuota de la ventana.
 *
 * Una ruta con `@RateLimit()` consume además su propia cuota; los headers
 * muestran esa cuota (la más estricta) y basta con agotar una de las dos
 * para recibir 429.
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
    const global = await this.rateLimiter.consume(ip);
    const routeLimit = RateLimitGuard.routeLimit(context);
    const route = routeLimit
      ? await this.rateLimiter.consume(`${routeLimit.name}:${ip}`, routeLimit)
      : undefined;

    const shown = route ?? global;
    response.setHeader('X-RateLimit-Limit', shown.limit);
    response.setHeader('X-RateLimit-Remaining', shown.remaining);
    response.setHeader('X-RateLimit-Reset', shown.resetSeconds);

    const blocked = [route, global].find((result) => result && !result.allowed);
    if (blocked) {
      response.setHeader('Retry-After', blocked.resetSeconds);
      throw new HttpException(
        `Demasiadas peticiones. Inténtalo de nuevo en ${blocked.resetSeconds} segundos.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private static routeLimit(
    context: ExecutionContext,
  ): RouteRateLimit | undefined {
    return (Reflect.getMetadata(RATE_LIMIT_METADATA, context.getHandler()) ??
      Reflect.getMetadata(RATE_LIMIT_METADATA, context.getClass())) as
      RouteRateLimit | undefined;
  }
}
