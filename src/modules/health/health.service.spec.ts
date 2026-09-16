import type { CacheService } from '@infrastructure/cache';
import type { PrismaService } from '@infrastructure/database';
import type { DatawarehouseService } from '@infrastructure/datawarehouse';
import type { StorageService } from '@infrastructure/storage';
import { HealthService } from './health.service';
import { HealthController } from './health.controller';

it('comparte la sonda y devuelve 503 con Redis caído, conservando liveness', async () => {
  const database = { healthCheck: jest.fn().mockResolvedValue(true) };
  const cache = { healthCheck: jest.fn().mockResolvedValue(false) };
  const service = new HealthService(
    database as unknown as PrismaService,
    {} as DatawarehouseService,
    cache as unknown as CacheService,
    {} as StorageService,
  );
  const controller = new HealthController(service);
  const results = await Promise.all(
    Array.from({ length: 250 }, () => service.isReady()),
  );
  expect(results.every((value) => !value)).toBe(true);
  expect(database.healthCheck).toHaveBeenCalledTimes(1);
  await expect(controller.ready()).rejects.toMatchObject({ status: 503 });
  expect(controller.live()).toEqual({ status: 'ok' });
});
