import {
  Controller,
  Get,
  ServiceUnavailableException,
  SetMetadata,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { HealthService, type HealthReport } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @SetMetadata('health:probe', true)
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @SetMetadata('health:probe', true)
  async ready(): Promise<{ status: string }> {
    if (!(await this.health.isReady())) {
      throw new ServiceUnavailableException('Dependencias no disponibles');
    }
    return { status: 'ok' };
  }

  @Get()
  @ApiOperation({ summary: 'Estado de la API y de sus dependencias' })
  check(): Promise<HealthReport> {
    return this.health.check();
  }
}
