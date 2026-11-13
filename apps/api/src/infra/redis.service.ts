import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { DependencyStatus } from '@ass/shared';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env.js';
import { withTimeout } from './with-timeout.js';

const CHECK_TIMEOUT_MS = 5000;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  /** `null` tant que REDIS_URL n'est pas renseignée. */
  readonly client: Redis | null;

  constructor(@Inject(ENV) env: Env) {
    if (!env.REDIS_URL) {
      this.client = null;
      return;
    }
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      // Exigé par BullMQ, qui réutilisera cette configuration.
      maxRetriesPerRequest: null,
    });
    // Sans écouteur, ioredis lève une exception non gérée à chaque coupure réseau.
    this.client.on('error', (error: Error) => this.logger.warn(`Redis : ${error.message}`));
  }

  async check(): Promise<DependencyStatus> {
    if (!this.client) return 'not_configured';
    try {
      const pong = await withTimeout(this.client.ping(), CHECK_TIMEOUT_MS);
      return pong === 'PONG' ? 'up' : 'down';
    } catch (error) {
      this.logger.warn(`Redis injoignable : ${(error as Error).message}`);
      return 'down';
    }
  }

  onModuleDestroy(): void {
    this.client?.disconnect();
  }
}
