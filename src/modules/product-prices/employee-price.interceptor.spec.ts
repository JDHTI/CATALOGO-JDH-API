import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import type { AuthenticatedUser } from '@common/auth';

import { EmployeePriceInterceptor } from './employee-price.interceptor';
import type {
  EmployeePrice,
  ProductPricesService,
} from './product-prices.service';

const PRICE: EmployeePrice = {
  precio: 49863,
  precioConIva: 59337,
  ivaPct: 19,
  ivaEtiqueta: 'IVA 19 %',
  moneda: 'COP',
  unidad: 'UNIDAD',
  fechaFoto: '2026-11-17',
};

const EMPLEADO: AuthenticatedUser = { sub: 'e', empleado: true };
const p = (id: number) => ({ id, sku: `S${id}` });

describe('EmployeePriceInterceptor', () => {
  const findForProducts = jest.fn(() => Promise.resolve(new Map([[1, PRICE]])));
  const interceptor = new EmployeePriceInterceptor({
    findForProducts,
  } as unknown as ProductPricesService);

  const run = async (user: AuthenticatedUser | undefined, body: unknown) => {
    const headers: Record<string, string> = {};
    const vary: string[] = [];
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ user }),
        getResponse: () => ({
          vary: (field: string) => vary.push(field),
          setHeader: (name: string, value: string) => (headers[name] = value),
        }),
      }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of(body) };

    const result = await firstValueFrom(interceptor.intercept(context, next));
    return { result, headers, vary };
  };

  beforeEach(() => findForProducts.mockClear());

  it('anónimo: sin campo, sin consulta, cacheable, con Vary', async () => {
    const body = { data: [p(1)], meta: {} };
    const { result, headers, vary } = await run(undefined, body);

    expect(result).toBe(body);
    expect(findForProducts).not.toHaveBeenCalled();
    expect(headers['Cache-Control']).toBeUndefined();
    expect(vary).toEqual(['Authorization']);
  });

  it('autenticado no empleado: sin campo pero private, no-store', async () => {
    const { result, headers } = await run({ sub: 'c', empleado: false }, p(1));

    expect(result).not.toHaveProperty('precioEmpleado');
    expect(headers['Cache-Control']).toBe('private, no-store');
  });

  it('empleado, listado: precio o null por producto, sin mutar el cacheado', async () => {
    const body = { data: [p(1), p(2)], meta: { total: 2 } };
    const { result } = await run(EMPLEADO, body);

    expect(findForProducts).toHaveBeenCalledWith('empleados-jdh', [1, 2]);
    expect(result).toEqual({
      data: [
        { ...p(1), precioEmpleado: PRICE },
        { ...p(2), precioEmpleado: null },
      ],
      meta: { total: 2 },
    });
    expect(body.data[0]).not.toHaveProperty('precioEmpleado');
  });

  it('empleado, ficha: un solo producto con su precio', async () => {
    const { result } = await run(EMPLEADO, p(1));

    expect(result).toEqual({ ...p(1), precioEmpleado: PRICE });
  });

  it('empleado, líneas de lista: el precio va dentro de `product`', async () => {
    const body = {
      data: [{ productId: 1, quantity: 2, product: p(1) }],
      meta: {},
    };
    const { result } = await run(EMPLEADO, body);

    expect(result).toEqual({
      data: [
        {
          productId: 1,
          quantity: 2,
          product: { ...p(1), precioEmpleado: PRICE },
        },
      ],
      meta: {},
    });
  });

  it('empleado, respuesta sin productos: igual y sin consultar', async () => {
    const body = { ids: [1, 2], total: 2 };
    const { result } = await run(EMPLEADO, body);

    expect(result).toBe(body);
    expect(findForProducts).not.toHaveBeenCalled();
  });
});
