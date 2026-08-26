import { Module } from '@nestjs/common';

import { LogosService } from './logos.service';

/**
 * Carga de logos comerciales.
 * Sin controlador a propósito: no se expone endpoint HTTP de subida mientras
 * el catálogo no tenga autenticación. El disparo es `pnpm logos:upload`.
 */
@Module({
  providers: [LogosService],
  exports: [LogosService],
})
export class LogosModule {}
