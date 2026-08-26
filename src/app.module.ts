import { Module } from '@nestjs/common';

import { RateLimitModule } from '@common/ratelimit';
import { InfrastructureModule } from '@infrastructure/infrastructure.module';
import { HealthModule } from '@modules/health/health.module';

@Module({
  imports: [InfrastructureModule, RateLimitModule, HealthModule],
})
export class AppModule {}
