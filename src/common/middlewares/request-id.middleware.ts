import { randomUUID } from 'node:crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** Header estándar de correlación de peticiones. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Asigna un identificador de correlación a cada petición.
 * Respeta el `X-Request-Id` entrante (para trazar cadenas de servicios) o
 * genera un UUID nuevo, y lo propaga siempre en la respuesta para que el
 * cliente pueda referenciarlo al reportar errores.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER)?.trim();
    const requestId = incoming || randomUUID();

    // Normalizado en minúsculas, como expone Express los headers entrantes.
    req.headers[REQUEST_ID_HEADER.toLowerCase()] = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    next();
  }
}
