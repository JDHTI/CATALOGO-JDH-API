import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';

import type { CacheService } from '@infrastructure/cache';

import { CacheTTL, NoCache } from '../decorators/cache.decorators';
import { HttpCacheInterceptor } from './http-cache.interceptor';

describe('HttpCacheInterceptor', () => {
  const reflector = new Reflector();

  const buildCache = (
    cached: unknown = null,
  ): { cache: CacheService; get: jest.Mock; set: jest.Mock } => {
    const get = jest.fn().mockResolvedValue(cached);
    const set = jest.fn().mockResolvedValue(undefined);
    const wrap = async (
      key: string,
      factory: () => Promise<unknown>,
      ttl?: number,
    ) => {
      const value: unknown = await get(key);
      if (value !== null) return value;
      const body = await factory();
      await set(key, body, ttl);
      return body;
    };
    return { cache: { get, set, wrap } as unknown as CacheService, get, set };
  };

  const buildContext = (
    method: string,
    handler: () => void = () => undefined,
    path = '/api/v1/products',
    query: Record<string, unknown> = {},
  ): ExecutionContext =>
    ({
      getType: () => 'http',
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({ method, path, query }),
      }),
    }) as unknown as ExecutionContext;

  const next: CallHandler = { handle: () => of({ data: 'fresco' }) };

  it('devuelve la respuesta cacheada sin ejecutar el handler', async () => {
    const { cache, set } = buildCache({ data: 'cacheado' });
    const interceptor = new HttpCacheInterceptor(cache, reflector);

    const result = await firstValueFrom(
      interceptor.intercept(buildContext('GET'), next),
    );

    expect(result).toEqual({ data: 'cacheado' });
    expect(set).not.toHaveBeenCalled();
  });

  it('ejecuta el handler y cachea la respuesta en un miss', async () => {
    const { cache, set } = buildCache(null);
    const interceptor = new HttpCacheInterceptor(cache, reflector);

    const result = await firstValueFrom(
      interceptor.intercept(buildContext('GET'), next),
    );

    expect(result).toEqual({ data: 'fresco' });
    expect(set).toHaveBeenCalledWith(
      'http:/api/v1/products',
      { data: 'fresco' },
      undefined,
    );
  });

  it('respeta el TTL declarado con @CacheTTL', async () => {
    const { cache, set } = buildCache(null);
    const interceptor = new HttpCacheInterceptor(cache, reflector);

    class Controller {
      @CacheTTL(120)
      list(this: void): void {}
    }
    const context = buildContext('GET', Controller.prototype.list);

    await firstValueFrom(interceptor.intercept(context, next));

    expect(set).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      120,
    );
  });

  it('no toca la caché con @NoCache ni en métodos distintos de GET', async () => {
    const { cache, get, set } = buildCache(null);
    const interceptor = new HttpCacheInterceptor(cache, reflector);

    class Controller {
      @NoCache()
      excluded(this: void): void {}
    }

    await firstValueFrom(
      interceptor.intercept(
        buildContext('GET', Controller.prototype.excluded),
        next,
      ),
    );
    await firstValueFrom(interceptor.intercept(buildContext('POST'), next));

    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('normaliza la query ordenando los parámetros', () => {
    const keyA = HttpCacheInterceptor.buildKey({
      path: '/api/v1/products',
      query: { page: '2', limit: '10' },
    } as never);
    const keyB = HttpCacheInterceptor.buildKey({
      path: '/api/v1/products',
      query: { limit: '10', page: '2' },
    } as never);

    expect(keyA).toBe(keyB);
    expect(keyA).toBe('http:/api/v1/products?limit="10"&page="2"');
  });
});
