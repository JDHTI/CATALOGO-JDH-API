import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { RequestIdMiddleware } from '@common/middlewares/request-id.middleware';
import { RateLimitModule } from '@common/ratelimit';
import { InfrastructureModule } from '@infrastructure/infrastructure.module';
import { HealthModule } from '@modules/health/health.module';
import { SuppliersModule } from '@modules/suppliers/suppliers.module';

@Module({
  imports: [
    InfrastructureModule,
    RateLimitModule,
    HealthModule,
    SuppliersModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Correlación de peticiones en toda la API.
    consumer.apply(RequestIdMiddleware).forRoutes('{*splat}');
  }
}
