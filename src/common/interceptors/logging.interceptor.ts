import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { tap, type Observable } from 'rxjs';

/** Registra método, ruta, duración y request id de cada petición HTTP. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const started = Date.now();

    const rawRequestId = request.headers['x-request-id'];
    const requestId = Array.isArray(rawRequestId)
      ? rawRequestId[0]
      : rawRequestId;
    const suffix = requestId ? ` [${requestId}]` : '';

    return next
      .handle()
      .pipe(
        tap(() =>
          this.logger.log(
            `${request.method} ${request.url} — ${Date.now() - started}ms${suffix}`,
          ),
        ),
      );
  }
}
