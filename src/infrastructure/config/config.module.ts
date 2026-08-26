import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import appConfig from './app.config';
import databaseConfig from './database.config';
import datawarehouseConfig from './datawarehouse.config';
import ratelimitConfig from './ratelimit.config';
import redisConfig from './redis.config';
import storageConfig from './storage.config';
import { validateEnv } from './env.validation';

/**
 * Punto único de carga y validación de configuración.
 * Cada preocupación se expone como namespace (`app`, `database`, ...).
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      envFilePath: ['.env.local', '.env'],
      load: [
        appConfig,
        databaseConfig,
        datawarehouseConfig,
        ratelimitConfig,
        redisConfig,
        storageConfig,
      ],
      validate: validateEnv,
    }),
  ],
})
export class ConfigModule {}
