import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { from, of, switchMap, tap, type Observable } from 'rxjs';

import { CacheService } from '@infrastructure/cache';

import {
  CACHE_TTL_METADATA,
  NO_CACHE_METADATA,
} from '../decorators/cache.decorators';

/**
 * Cachea en Redis las respuestas de peticiones GET.
 *
 * La clave es `http:<ruta>?<query normalizada>` (parámetros ordenados
 * alfabéticamente para que el orden en la URL no genere claves distintas).
 * El TTL por defecto es `REDIS_DEFAULT_TTL` y puede sobreescribirse por
 * handler/controlador con `@CacheTTL(segundos)`; `@NoCache()` excluye.
 *
 * NO se aplica globalmente: cada controlador de lectura lo declara con
 * `@UseInterceptors(HttpCacheInterceptor)`.
 */
@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
  constructor(
    private readonly cache: CacheService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<Request>();
    if (request.method !== 'GET') return next.handle();

    const noCache = this.reflector.getAllAndOverride<boolean>(
      NO_CACHE_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (noCache) return next.handle();

    const ttl = this.reflector.getAllAndOverride<number | undefined>(
      CACHE_TTL_METADATA,
      [context.getHandler(), context.getClass()],
    );
    const key = HttpCacheInterceptor.buildKey(request);

    return from(this.cache.get<unknown>(key)).pipe(
      switchMap((cached) => {
        if (cached !== null) return of(cached);

        return next.handle().pipe(
          tap((body) => {
            // No cacheamos cuerpos vacíos: null es indistinguible de un miss.
            if (body === undefined || body === null) return;
            void this.cache.set(key, body, ttl);
          }),
        );
      }),
    );
  }

  /** Construye la clave de caché: ruta + query con parámetros ordenados. */
  static buildKey(request: Pick<Request, 'path' | 'query'>): string {
    const entries = Object.entries(request.query ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    );

    const query = entries
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      .join('&');

    return query ? `http:${request.path}?${query}` : `http:${request.path}`;
  }
}
