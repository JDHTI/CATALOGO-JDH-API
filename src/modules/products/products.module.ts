import { Module } from '@nestjs/common';

import { AuthModule } from '@common/auth';
import { ProductPricesModule } from '@modules/product-prices/product-prices.module';

import { ProductsController } from './products.controller';
import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';

@Module({
  imports: [AuthModule, ProductPricesModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductsRepository],
  exports: [ProductsService],
})
export class ProductsModule {}
