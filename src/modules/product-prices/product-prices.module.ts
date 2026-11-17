import { Module } from '@nestjs/common';

import { EmployeePriceInterceptor } from './employee-price.interceptor';
import { ProductPricesService } from './product-prices.service';

/**
 * Listas de precios externas al DWH (hoy: empleados JDH). Se cargan por CLI
 * (`pnpm prices:load`) y `/products` las superpone a la respuesta. Ver
 * docs/product-prices.md.
 */
@Module({
  providers: [ProductPricesService, EmployeePriceInterceptor],
  exports: [ProductPricesService, EmployeePriceInterceptor],
})
export class ProductPricesModule {}
