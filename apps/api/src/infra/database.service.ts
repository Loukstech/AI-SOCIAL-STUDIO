import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@ass/database';
import type { DependencyStatus } from '@ass/shared';
import { ENV, type Env } from '../config/env.js';
import { withTimeout } from './with-timeout.js';

const CHECK_TIMEOUT_MS = 5000;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  /** `null` tant que DATABASE_URL n'est pas renseignée. */
  readonly client: PrismaClient | null;

  constructor(@Inject(ENV) env: Env) {
    this.client = env.DATABASE_URL ? createPrismaClient(env.DATABASE_URL) : null;
  }

  async check(): Promise<DependencyStatus> {
    if (!this.client) return 'not_configured';
    try {
      await withTimeout(this.client.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS);
      return 'up';
    } catch (error) {
      this.logger.warn(`PostgreSQL injoignable : ${(error as Error).message}`);
      return 'down';
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }
}
