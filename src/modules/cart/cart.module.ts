import { Module } from '@nestjs/common';

import { AuthModule } from '@common/auth';
import { ProductPricesModule } from '@modules/product-prices/product-prices.module';

import { CartController, OrdersController } from './cart.controller';
import { CartService } from './cart.service';

/** Carrito y pedidos de empleados JDH. Ver docs/carrito-pedidos.md. */
@Module({
  imports: [AuthModule, ProductPricesModule],
  controllers: [CartController, OrdersController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
