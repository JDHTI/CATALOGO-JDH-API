import { Module } from '@nestjs/common';

import { AuthModule } from '@common/auth';
import { ProductPricesModule } from '@modules/product-prices/product-prices.module';

import { OrderListsController } from './order-lists.controller';
import { OrderListsRepository } from './order-lists.repository';
import { OrderListsService } from './order-lists.service';

@Module({
  imports: [AuthModule, ProductPricesModule],
  controllers: [OrderListsController],
  providers: [OrderListsService, OrderListsRepository],
})
export class OrderListsModule {}
