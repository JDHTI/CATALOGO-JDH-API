import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

export interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error: string;
  code?: string;
  path: string;
  timestamp: string;
  /** Solo en 4xx: campos propios del error (ver `extraFields`). */
  [extra: string]: unknown;
}

/** Normaliza cualquier error en una respuesta JSON consistente. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload = isHttp ? exception.getResponse() : null;
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? (payload as { message: string | string[] }).message
        : isHttp
          ? exception.message
          : 'Error interno del servidor';
    const code =
      typeof payload === 'object' &&
      payload !== null &&
      'code' in payload &&
      typeof (payload as { code?: unknown }).code === 'string'
        ? (payload as { code: string }).code
        : undefined;

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponseBody = {
      // Campos extra de un error 4xx (p. ej. `resumen` o `noDisponibles` del
      // 409 del carrito): los arma el propio API para que el cliente pueda
      // reaccionar. Nunca en 5xx, que no deben exponer detalles internos. Los
      // campos estándar van después y no se pueden sobrescribir.
      ...(isHttp && status < 500 ? extraFields(payload) : {}),
      statusCode: status,
      message,
      error: isHttp ? exception.name : 'InternalServerError',
      ...(code ? { code } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(body);
  }
}

const STANDARD_FIELDS = new Set([
  'statusCode',
  'message',
  'error',
  'code',
  'path',
  'timestamp',
]);

/** Campos del cuerpo de un `HttpException` que no son los estándar. */
function extraFields(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null) return {};
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => !STANDARD_FIELDS.has(key)),
  );
}
