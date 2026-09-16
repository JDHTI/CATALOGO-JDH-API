import type { NextFunction, Request, Response } from 'express';

/** Límite por proceso: evita acumular una cola HTTP sin límite al degradarse la BD. */
export function concurrencyLimit(max: number, probePaths: string[]) {
  let active = 0;
  return (request: Request, response: Response, next: NextFunction): void => {
    if (request.method === 'GET' && probePaths.includes(request.path)) {
      next();
      return;
    }
    if (active >= max) {
      response.setHeader('Retry-After', '1');
      response.status(503).json({
        statusCode: 503,
        message: 'Servidor ocupado. Reintenta en un segundo.',
        error: 'ServiceUnavailableException',
        code: 'CAPACITY_EXCEEDED',
        path: request.originalUrl ?? request.path,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    active++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active--;
      response.off('finish', release);
      response.off('close', release);
    };
    response.once('finish', release);
    response.once('close', release);
    next();
  };
}
