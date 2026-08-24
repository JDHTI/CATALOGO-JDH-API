import { Module } from '@nestjs/common';

import { CacheModule } from './cache';
import { ConfigModule } from './config';
import { DatawarehouseModule } from './datawarehouse';
import { PrismaModule } from './database';
import { StorageModule } from './storage';

/**
 * Agrupa toda la infraestructura técnica de la aplicación.
 * Los módulos de dominio (`src/modules`) consumen estos servicios sin conocer
 * su implementación concreta.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    DatawarehouseModule,
    CacheModule,
    StorageModule,
  ],
})
export class InfrastructureModule {}
