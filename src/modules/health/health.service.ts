import { Injectable } from '@nestjs/common';

import { CacheService } from '@infrastructure/cache';
import { PrismaService } from '@infrastructure/database';
import { DatawarehouseService } from '@infrastructure/datawarehouse';
import { StorageService } from '@infrastructure/storage';

export type DependencyStatus = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'degraded';
  dependencies: Record<string, DependencyStatus>;
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly datawarehouse: DatawarehouseService,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
  ) {}

  async check(): Promise<HealthReport> {
    const checks = {
      database: () => this.prisma.healthCheck(),
      datawarehouse: () => this.datawarehouse.healthCheck(),
      cache: () => this.cache.healthCheck(),
      storage: () => this.storage.healthCheck(),
    };

    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, probe]) => {
        try {
          return [name, (await probe()) ? 'up' : 'down'] as const;
        } catch {
          return [name, 'down'] as const;
        }
      }),
    );

    const dependencies = Object.fromEntries(entries) as Record<
      string,
      DependencyStatus
    >;

    return {
      status: Object.values(dependencies).every((s) => s === 'up')
        ? 'ok'
        : 'degraded',
      dependencies,
      timestamp: new Date().toISOString(),
    };
  }
}
