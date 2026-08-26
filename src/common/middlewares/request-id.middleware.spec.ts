import type { NextFunction, Request, Response } from 'express';

import { RequestIdMiddleware } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  const middleware = new RequestIdMiddleware();

  const buildMocks = (
    incoming?: string,
  ): {
    req: Request;
    res: Response;
    next: NextFunction;
    setHeader: jest.Mock;
  } => {
    const headers: Record<string, string> = {};
    const req = {
      headers,
      header: () => incoming,
    } as unknown as Request;
    const setHeader = jest.fn();
    const res = { setHeader } as unknown as Response;
    const next = jest.fn() as NextFunction;

    return { req, res, next, setHeader };
  };

  it('respeta el X-Request-Id entrante y lo propaga en la respuesta', () => {
    const { req, res, next, setHeader } = buildMocks('abc-123');

    middleware.use(req, res, next);

    expect(req.headers['x-request-id']).toBe('abc-123');
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'abc-123');
    expect(next).toHaveBeenCalled();
  });

  it('genera un UUID cuando la petición no trae X-Request-Id', () => {
    const { req, res, next, setHeader } = buildMocks(undefined);

    middleware.use(req, res, next);

    const generated = req.headers['x-request-id'];
    expect(generated).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', generated);
    expect(next).toHaveBeenCalled();
  });
});
