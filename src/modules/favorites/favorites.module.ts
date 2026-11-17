import { Module } from '@nestjs/common';

import { AuthModule } from '@common/auth';
import { ProductPricesModule } from '@modules/product-prices/product-prices.module';

import { FavoritesController } from './favorites.controller';
import { FavoritesRepository } from './favorites.repository';
import { FavoritesService } from './favorites.service';

@Module({
  imports: [AuthModule, ProductPricesModule],
  controllers: [FavoritesController],
  providers: [FavoritesService, FavoritesRepository],
})
export class FavoritesModule {}
