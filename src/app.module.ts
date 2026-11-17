import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { RequestIdMiddleware } from '@common/middlewares/request-id.middleware';
import { RateLimitModule } from '@common/ratelimit';
import { InfrastructureModule } from '@infrastructure/infrastructure.module';
import { BrandMediaModule } from '@modules/brand-media/brand-media.module';
import { BrandsModule } from '@modules/brands/brands.module';
import { CartModule } from '@modules/cart/cart.module';
import { CategoriesModule } from '@modules/categories/categories.module';
import { FavoritesModule } from '@modules/favorites/favorites.module';
import { HealthModule } from '@modules/health/health.module';
import { LogosModule } from '@modules/logos/logos.module';
import { OrderListsModule } from '@modules/order-lists/order-lists.module';
import { ProductImagesModule } from '@modules/product-images/product-images.module';
import { ProductContentModule } from '@modules/product-content/product-content.module';
import { ProductsModule } from '@modules/products/products.module';
import { SiteImagesModule } from '@modules/site-images/site-images.module';
import { SuppliersModule } from '@modules/suppliers/suppliers.module';
import { SyncModule } from '@modules/sync/sync.module';

@Module({
  imports: [
    InfrastructureModule,
    RateLimitModule,
    HealthModule,
    SuppliersModule,
    BrandsModule,
    CategoriesModule,
    ProductsModule,
    FavoritesModule,
    OrderListsModule,
    CartModule,
    SyncModule,
    LogosModule,
    ProductImagesModule,
    ProductContentModule,
    SiteImagesModule,
    BrandMediaModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Correlación de peticiones en toda la API.
    consumer.apply(RequestIdMiddleware).forRoutes('{*splat}');
  }
}
