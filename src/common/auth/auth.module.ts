import { Module } from '@nestjs/common';

import { EmployeeGuard } from './employee.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

/**
 * Expone el guard JWT a los módulos que lo necesiten.
 *
 * A diferencia de `RateLimitModule`, NO registra un `APP_GUARD`: la
 * autenticación es opt-in por ruta. Todo el catálogo es público y debe
 * seguir siéndolo.
 */
@Module({
  providers: [JwtAuthGuard, OptionalJwtAuthGuard, EmployeeGuard],
  exports: [JwtAuthGuard, OptionalJwtAuthGuard, EmployeeGuard],
})
export class AuthModule {}
