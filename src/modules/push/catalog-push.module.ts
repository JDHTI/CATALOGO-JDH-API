import { Module } from '@nestjs/common';

import { InfrastructureModule } from '@infrastructure/infrastructure.module';

import { CatalogPushService } from './catalog-push.service';

/**
 * Publicación del catálogo local hacia otra instancia (Railway).
 *
 * A propósito NO está en `AppModule`: es una herramienta local que solo usa el
 * CLI `pnpm push:catalogo`. La API desplegada no tiene ninguna razón para
 * conocer una segunda base de datos, y así tampoco carga este código.
 */
@Module({
  imports: [InfrastructureModule],
  providers: [CatalogPushService],
  exports: [CatalogPushService],
})
export class CatalogPushModule {}
