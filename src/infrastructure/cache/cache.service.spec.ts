import type { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CacheService } from './cache.service';

jest.mock('ioredis');

describe('CacheService bajo concurrencia', () => {
  const redis = {
    status: 'ready',
    on: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    disconnect: jest.fn(),
  };
  let cache: CacheService;

  beforeEach(() => {
    jest.clearAllMocks();
    redis.status = 'ready';
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue('OK');
    (Redis as unknown as jest.Mock).mockImplementation(() => redis);
    cache = new CacheService({
      getOrThrow: () => ({ defaultTtl: 300 }),
    } as unknown as ConfigService);
  });

  it('250 lecturas simultáneas de una clave ejecutan una sola consulta', async () => {
    const factory = jest.fn(() => Promise.resolve({ data: [1, 2] }));
    const values = await Promise.all(
      Array.from({ length: 250 }, () => cache.wrap('http:products', factory)),
    );
    expect(values).toHaveLength(250);
    expect(values.every((value) => value.data.length === 2)).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(redis.get).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it('libera el trabajo fallido para permitir un reintento', async () => {
    const factory = jest
      .fn()
      .mockRejectedValueOnce(new Error('db'))
      .mockResolvedValueOnce('ok');
    const values = await Promise.allSettled(
      Array.from({ length: 250 }, () => cache.wrap('key', factory)),
    );
    expect(values.every((value) => value.status === 'rejected')).toBe(true);
    await expect(cache.wrap('key', factory)).resolves.toBe('ok');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('agrupa consultas aun sin Redis, sin encolar comandos desconectados', async () => {
    redis.status = 'reconnecting';
    const factory = jest.fn().mockResolvedValue('ok');
    await Promise.all(
      Array.from({ length: 250 }, () => cache.wrap('key', factory)),
    );
    expect(factory).toHaveBeenCalledTimes(1);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('una invalidación impide republicar el resultado anterior en vuelo', async () => {
    let resolve!: (value: string) => void;
    const pending = cache.wrap(
      'key',
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    await Promise.resolve();
    await cache.del('key');
    resolve('viejo');
    await pending;
    expect(redis.set).not.toHaveBeenCalled();
    await expect(
      cache.wrap('key', () => Promise.resolve('nuevo')),
    ).resolves.toBe('nuevo');
  });

  it('no almacena cuerpos vacíos ni TTL deshabilitado, y escalona la expiración', async () => {
    await cache.set('key', null);
    await cache.set('key', undefined);
    await cache.set('key', 'value', 0);
    expect(redis.set).not.toHaveBeenCalled();
    await cache.set('key', 'value', 300);
    const args = redis.set.mock.calls[0] as unknown[];
    const ttl = args[3] as number;
    expect(ttl).toBeGreaterThanOrEqual(270);
    expect(ttl).toBeLessThanOrEqual(300);
  });
});
