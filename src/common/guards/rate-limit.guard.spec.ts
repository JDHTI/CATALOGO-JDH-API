import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { RateLimit } from '../decorators/rate-limit.decorator';
import type {
  RateLimiter,
  RateLimitResult,
} from '../ratelimit/rate-limiter.interface';
import { RateLimitGuard } from './rate-limit.guard';

describe('RateLimitGuard', () => {
  it('no usa Redis ni cuota para las sondas marcadas por el servidor', async () => {
    const handler = () => undefined;
    Reflect.defineMetadata('health:probe', true, handler);
    const consume = jest.fn();
    const guard = new RateLimitGuard({ consume });
    const context = {
      getType: () => 'http',
      getHandler: () => handler,
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(consume).not.toHaveBeenCalled();
  });
  const buildContext = (
    handler: () => void = () => undefined,
  ): {
    context: ExecutionContext;
    setHeader: jest.Mock;
  } => {
    const setHeader = jest.fn();
    const context = {
      getType: () => 'http',
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({ ip: '1.2.3.4' }),
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext;

    return { context, setHeader };
  };

  const buildGuard = (result: RateLimitResult): RateLimitGuard => {
    const limiter: RateLimiter = {
      consume: jest.fn().mockResolvedValue(result),
    };
    return new RateLimitGuard(limiter);
  };

  it('permite la petición y añade los headers X-RateLimit-*', async () => {
    const guard = buildGuard({
      allowed: true,
      limit: 100,
      remaining: 99,
      resetSeconds: 60,
    });
    const { context, setHeader } = buildContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 99);
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', 60);
  });

  it('responde 429 con Retry-After cuando se agota la cuota', async () => {
    const guard = buildGuard({
      allowed: false,
      limit: 100,
      remaining: 0,
      resetSeconds: 30,
    });
    const { context, setHeader } = buildContext();

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 429,
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(setHeader).toHaveBeenCalledWith('Retry-After', 30);
  });

  describe('con @RateLimit en la ruta', () => {
    const limitedHandler = (): void => undefined;
    RateLimit({ name: 'contact-leads', ttl: 600, max: 5 })({}, 'handler', {
      value: limitedHandler,
    } as PropertyDescriptor);

    const allowedGlobal: RateLimitResult = {
      allowed: true,
      limit: 100,
      remaining: 99,
      resetSeconds: 60,
    };

    it('consume la cuota global y la de la ruta, y muestra la de la ruta', async () => {
      const consume = jest
        .fn()
        .mockResolvedValueOnce(allowedGlobal)
        .mockResolvedValueOnce({
          allowed: true,
          limit: 5,
          remaining: 4,
          resetSeconds: 600,
        });
      const guard = new RateLimitGuard({ consume });
      const { context, setHeader } = buildContext(limitedHandler);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(consume).toHaveBeenNthCalledWith(1, '1.2.3.4');
      expect(consume).toHaveBeenNthCalledWith(2, 'contact-leads:1.2.3.4', {
        name: 'contact-leads',
        ttl: 600,
        max: 5,
      });
      expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 5);
      expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 4);
    });

    it('responde 429 si se agota la cuota de la ruta aunque la global no', async () => {
      const consume = jest
        .fn()
        .mockResolvedValueOnce(allowedGlobal)
        .mockResolvedValueOnce({
          allowed: false,
          limit: 5,
          remaining: 0,
          resetSeconds: 420,
        });
      const guard = new RateLimitGuard({ consume });
      const { context, setHeader } = buildContext(limitedHandler);

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: 429,
      });
      expect(setHeader).toHaveBeenCalledWith('Retry-After', 420);
    });
  });

  it('ignora contextos que no son HTTP', async () => {
    const consume = jest.fn();
    const guard = new RateLimitGuard({ consume });
    const context = { getType: () => 'rpc' } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(consume).not.toHaveBeenCalled();
  });
});
