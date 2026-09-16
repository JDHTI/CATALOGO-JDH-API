import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { concurrencyLimit } from './concurrency-limit.middleware';

function response() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnValue(emitter),
    json: jest.fn(),
  });
}

it('rechaza exceso, mantiene sondas y libera cada petición solo una vez', () => {
  const middleware = concurrencyLimit(1, ['/health/live']);
  const request = { method: 'GET', path: '/products' } as Request;
  const first = response();
  const next = jest.fn();
  middleware(request, first as unknown as Response, next);
  const rejected = response();
  middleware(request, rejected as unknown as Response, next);
  expect(rejected.status).toHaveBeenCalledWith(503);
  expect(rejected.json).toHaveBeenCalledWith(
    expect.objectContaining({
      statusCode: 503,
      code: 'CAPACITY_EXCEEDED',
      path: '/products',
      error: 'ServiceUnavailableException',
    }),
  );
  middleware(
    { ...request, path: '/health/live' } as Request,
    response() as unknown as Response,
    next,
  );
  expect(next).toHaveBeenCalledTimes(2);
  first.emit('finish');
  first.emit('close');
  middleware(request, response() as unknown as Response, next);
  middleware(request, rejected as unknown as Response, next);
  expect(next).toHaveBeenCalledTimes(3);
  expect(rejected.status).toHaveBeenCalledTimes(2);
});
