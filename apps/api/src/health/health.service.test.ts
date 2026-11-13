import { describe, expect, it } from 'vitest';
import { healthResponseSchema, type DependencyStatus } from '@ass/shared';
import { parseEnv } from '../config/env.js';
import { HealthService } from './health.service.js';

const dep = (status: DependencyStatus) => ({ check: async () => status });

describe('HealthService', () => {
  it('renvoie ok quand PostgreSQL et Redis répondent', async () => {
    const service = new HealthService(parseEnv({}), dep('up'), dep('up'));
    const health = await service.getHealth();
    expect(health.status).toBe('ok');
    expect(healthResponseSchema.safeParse(health).success).toBe(true);
  });

  it('renvoie degraded et détaille la dépendance fautive', async () => {
    const service = new HealthService(parseEnv({}), dep('up'), dep('down'));
    const health = await service.getHealth();
    expect(health.status).toBe('degraded');
    expect(health.dependencies).toEqual({ database: 'up', redis: 'down' });
  });
});
