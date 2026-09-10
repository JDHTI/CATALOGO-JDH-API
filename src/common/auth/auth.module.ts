import { Module } from '@nestjs/common';

import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Expone el guard JWT a los módulos que lo necesiten.
 *
 * A diferencia de `RateLimitModule`, NO registra un `APP_GUARD`: la
 * autenticación es opt-in por ruta. Todo el catálogo es público y debe
 * seguir siéndolo.
 */
@Module({
  providers: [JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
