import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { mergeMap, type Observable } from 'rxjs';

import type { AuthenticatedRequest } from '@common/auth';

import { EMPLOYEE_PRICE_LIST } from './price-list.file';
import { ProductPricesService } from './product-prices.service';

/** Lo mínimo que hace falta para reconocer un producto en una respuesta. */
interface ProductLike {
  id: number;
  sku: string;
}

/**
 * Añade `precioEmpleado` a los productos de una respuesta cuando quien pide es
 * un empleado JDH autenticado (claim `empleado` verificado por el guard). Para
 * cualquier otro el campo NO existe.
 *
 * Reconoce tres formas, las que usa el catálogo:
 * - un producto suelto (`GET /products/:id`);
 * - `{ data: Producto[] }` (`/products`, `/favorites`);
 * - `{ data: [{ product: Producto, … }] }` (líneas de listas de pedido).
 *
 * Va POR FUERA de `HttpCacheInterceptor`: Redis solo guarda la respuesta
 * anónima y el precio se superpone en cada petición. El cuerpo puede ser un
 * objeto cacheado compartido entre peticiones en vuelo: se copia, nunca se muta.
 *
 * Cabeceras: `Vary: Authorization` siempre y `Cache-Control: private,
 * no-store` en toda petición autenticada.
 *
 * Declararlo solo en handlers que devuelven productos: en otra respuesta no
 * encuentra nada que enriquecer y la devuelve igual.
 */
@Injectable()
export class EmployeePriceInterceptor implements NestInterceptor {
  constructor(private readonly prices: ProductPricesService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();

    response.vary('Authorization');
    if (!request.user) return next.handle();

    response.setHeader('Cache-Control', 'private, no-store');
    if (!request.user.empleado) return next.handle();

    return next
      .handle()
      .pipe(mergeMap((body: unknown) => this.withEmployeePrices(body)));
  }

  private async withEmployeePrices(body: unknown): Promise<unknown> {
    const entries =
      isRecord(body) && Array.isArray(body.data) ? body.data : [body];
    const products = entries
      .map(productOf)
      .filter((product): product is ProductLike => product !== null);
    if (products.length === 0) return body;

    const prices = await this.prices.findForProducts(
      EMPLOYEE_PRICE_LIST,
      products.map((product) => product.id),
    );
    const priced = (product: ProductLike) => ({
      ...product,
      precioEmpleado: prices.get(product.id) ?? null,
    });
    const enrich = (entry: unknown): unknown => {
      if (isProduct(entry)) return priced(entry);
      if (isRecord(entry) && isProduct(entry.product)) {
        return { ...entry, product: priced(entry.product) };
      }
      return entry;
    };

    return isRecord(body) && Array.isArray(body.data)
      ? { ...body, data: body.data.map(enrich) }
      : enrich(body);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProduct(value: unknown): value is ProductLike {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.sku === 'string'
  );
}

function productOf(entry: unknown): ProductLike | null {
  if (isProduct(entry)) return entry;
  if (isRecord(entry) && isProduct(entry.product)) return entry.product;
  return null;
}
