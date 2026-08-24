import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import type { HealthReport } from './../src/modules/health/health.service';

describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health devuelve el estado de cada dependencia', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    const body = response.body as HealthReport;

    expect(body.status).toMatch(/^(ok|degraded)$/);
    for (const dependency of [
      'database',
      'datawarehouse',
      'cache',
      'storage',
    ] as const) {
      expect(body.dependencies[dependency]).toMatch(/^(up|down|disabled)$/);
    }
  });
});
