import { describe, expect, it } from 'vitest';
import { healthResponseSchema, overallStatus } from './health.js';

describe('overallStatus', () => {
  it('vaut ok quand toutes les dépendances répondent', () => {
    expect(overallStatus({ database: 'up', redis: 'up' })).toBe('ok');
  });

  it('vaut degraded si une dépendance est en panne ou non configurée', () => {
    expect(overallStatus({ database: 'up', redis: 'down' })).toBe('degraded');
    expect(overallStatus({ database: 'not_configured', redis: 'up' })).toBe('degraded');
  });
});

describe('healthResponseSchema', () => {
  it('rejette un état de dépendance inconnu', () => {
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      version: '0.0.0',
      environment: 'test',
      uptimeSeconds: 1,
      timestamp: new Date().toISOString(),
      dependencies: { database: 'maybe', redis: 'up' },
    });
    expect(result.success).toBe(false);
  });
});
