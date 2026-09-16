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
  private readiness?: Promise<boolean>;
  private readinessExpires = 0;
  constructor(
    private readonly prisma: PrismaService,
    private readonly datawarehouse: DatawarehouseService,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
  ) {}

  /** Una sonda compartida por 2s; el DWH y las imágenes no bloquean la API. */
  isReady(): Promise<boolean> {
    if (this.readiness && Date.now() < this.readinessExpires)
      return this.readiness;
    this.readinessExpires = Infinity;
    this.readiness = Promise.all([
      this.prisma.healthCheck(),
      this.cache.healthCheck(),
    ])
      .then(
        (results) => results.every(Boolean),
        () => false,
      )
      .finally(() => {
        this.readinessExpires = Date.now() + 2000;
      });
    return this.readiness;
  }

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
