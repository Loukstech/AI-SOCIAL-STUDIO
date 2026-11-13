import { Inject, Injectable } from '@nestjs/common';
import { overallStatus, type HealthResponse } from '@ass/shared';
import { ENV, type Env } from '../config/env.js';
import { DatabaseService } from '../infra/database.service.js';
import { RedisService } from '../infra/redis.service.js';
import { APP_VERSION } from '../version.js';

@Injectable()
export class HealthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DatabaseService) private readonly database: Pick<DatabaseService, 'check'>,
    @Inject(RedisService) private readonly redis: Pick<RedisService, 'check'>,
  ) {}

  async getHealth(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([this.database.check(), this.redis.check()]);
    const dependencies = { database, redis };
    return {
      status: overallStatus(dependencies),
      version: APP_VERSION,
      environment: this.env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }
}
