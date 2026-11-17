import {
  ConflictException,
  InternalServerErrorException,
  type ArgumentsHost,
} from '@nestjs/common';

import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown): {
  status: number;
  body: Record<string, unknown>;
} {
  const out = { status: 0, body: {} as Record<string, unknown> };
  const response = {
    status: (code: number) => {
      out.status = code;
      return response;
    },
    json: (body: Record<string, unknown>) => {
      out.body = body;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'POST', url: '/api/v1/cart/checkout' }),
    }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);
  return out;
}

describe('AllExceptionsFilter', () => {
  it('conserva los campos propios de un 4xx (resumen, code)', () => {
    const { status, body } = run(
      new ConflictException({
        message: 'Los precios cambiaron',
        code: 'PRECIOS_CAMBIARON',
        resumen: { total: 10 },
      }),
    );

    expect(status).toBe(409);
    expect(body).toMatchObject({
      statusCode: 409,
      message: 'Los precios cambiaron',
      code: 'PRECIOS_CAMBIARON',
      resumen: { total: 10 },
      path: '/api/v1/cart/checkout',
    });
  });

  it('los campos extra no pisan los estándar', () => {
    const { body } = run(
      new ConflictException({ message: 'x', statusCode: 200, path: '/otro' }),
    );

    expect(body.statusCode).toBe(409);
    expect(body.path).toBe('/api/v1/cart/checkout');
  });

  it('un 5xx no expone campos extra', () => {
    const { body } = run(
      new InternalServerErrorException({ message: 'x', detalle: 'interno' }),
    );

    expect(body).not.toHaveProperty('detalle');
  });
});
