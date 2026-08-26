import { ConfigService } from '@nestjs/config';

import type { CacheService } from '@infrastructure/cache';

import { RedisRateLimiterService } from './redis-rate-limiter.service';

describe('RedisRateLimiterService', () => {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue({ ttl: 60, max: 3 }),
  } as unknown as ConfigService;

  const buildService = (evalMock: jest.Mock): RedisRateLimiterService => {
    const cache = { raw: { eval: evalMock } } as unknown as CacheService;
    return new RedisRateLimiterService(cache, configService);
  };

  it('permite la petición mientras no se supere el máximo', async () => {
    const service = buildService(jest.fn().mockResolvedValue([1, 60]));

    const result = await service.consume('1.2.3.4');

    expect(result).toEqual({
      allowed: true,
      limit: 3,
      remaining: 2,
      resetSeconds: 60,
    });
  });

  it('bloquea la petición cuando el contador supera el máximo', async () => {
    const service = buildService(jest.fn().mockResolvedValue([4, 42]));

    const result = await service.consume('1.2.3.4');

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetSeconds).toBe(42);
  });

  it('falla abierto si Redis no está disponible', async () => {
    const service = buildService(
      jest.fn().mockRejectedValue(new Error('conexión rechazada')),
    );

    const result = await service.consume('1.2.3.4');

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });

  it('usa una clave por IP con el prefijo ratelimit:', async () => {
    const evalMock = jest.fn().mockResolvedValue([1, 60]);
    const service = buildService(evalMock);

    await service.consume('10.0.0.1');

    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:10.0.0.1',
      60,
    );
  });
});
