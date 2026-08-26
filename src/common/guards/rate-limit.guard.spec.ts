import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import type {
  RateLimiter,
  RateLimitResult,
} from '../ratelimit/rate-limiter.interface';
import { RateLimitGuard } from './rate-limit.guard';

describe('RateLimitGuard', () => {
  const buildContext = (): {
    context: ExecutionContext;
    setHeader: jest.Mock;
  } => {
    const setHeader = jest.fn();
    const context = {
      getType: () => 'http',
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

  it('ignora contextos que no son HTTP', async () => {
    const consume = jest.fn();
    const guard = new RateLimitGuard({ consume });
    const context = { getType: () => 'rpc' } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(consume).not.toHaveBeenCalled();
  });
});
