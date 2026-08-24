import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@prisma-client';
import { DATABASE_CONFIG, type DatabaseConfig } from '@infrastructure/config';

/**
 * Cliente Prisma de la base de datos propia del catálogo.
 * Único punto de acceso transaccional para los módulos de dominio.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const database = config.getOrThrow<DatabaseConfig>(DATABASE_CONFIG);

    super({
      // Prisma 7 se conecta mediante driver adapter.
      adapter: new PrismaPg({ connectionString: database.url }),
      log: database.logQueries
        ? ['query', 'info', 'warn', 'error']
        : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Conexión establecida con la base de datos del catálogo');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Comprobación ligera para el endpoint de health. */
  async healthCheck(): Promise<boolean> {
    await this.$queryRaw`SELECT 1`;
    return true;
  }
}
