import { Injectable } from '@nestjs/common';

import { CacheService } from '@infrastructure/cache';
import { PrismaService } from '@infrastructure/database';
import { DatawarehouseService } from '@infrastructure/datawarehouse';
import { StorageService } from '@infrastructure/storage';

/** `disabled` = dependencia opcional no configurada; no degrada el estado. */
export type DependencyStatus = 'up' | 'down' | 'disabled';

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
    const checks: Record<string, () => Promise<boolean> | null> = {
      database: () => this.prisma.healthCheck(),
      // El DWH es opcional: si no está configurado se reporta `disabled`.
      datawarehouse: () =>
        this.datawarehouse.enabled ? this.datawarehouse.healthCheck() : null,
      cache: () => this.cache.healthCheck(),
      storage: () => this.storage.healthCheck(),
    };

    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, probe]) => {
        try {
          const result = probe();
          if (result === null) return [name, 'disabled'] as const;
          return [name, (await result) ? 'up' : 'down'] as const;
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
      status: Object.values(dependencies).every((s) => s !== 'down')
        ? 'ok'
        : 'degraded',
      dependencies,
      timestamp: new Date().toISOString(),
    };
  }
}
