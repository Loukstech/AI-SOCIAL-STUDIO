import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@ass/shared';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  /**
   * Répond toujours 200 tant que le processus tourne (sonde de vivacité des hébergeurs) ;
   * l'état réel des dépendances est dans le corps de la réponse.
   */
  @Get()
  @ApiOperation({ summary: "État de l'API et de ses dépendances (public)" })
  @ApiOkResponse({
    schema: {
      example: {
        status: 'degraded',
        version: '0.0.0',
        environment: 'development',
        uptimeSeconds: 12,
        timestamp: '2026-11-13T10:00:00.000Z',
        dependencies: { database: 'up', redis: 'not_configured' },
      },
    },
  })
  getHealth(): Promise<HealthResponse> {
    return this.health.getHealth();
  }
}
