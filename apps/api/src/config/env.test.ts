import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

describe('parseEnv', () => {
  it('applique les valeurs par défaut en développement, sans base ni Redis', () => {
    const env = parseEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.REDIS_URL).toBeUndefined();
  });

  it('traite une variable vide comme absente', () => {
    expect(parseEnv({ DATABASE_URL: '  ', REDIS_URL: '' }).DATABASE_URL).toBeUndefined();
  });

  it('découpe la liste des origines CORS', () => {
    const env = parseEnv({ CORS_ORIGINS: 'https://a.example, https://b.example' });
    expect(env.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });

  it('refuse une URL de base au mauvais schéma', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });

  it('exige la base et Redis en production', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL est requis/);
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@h/db',
        REDIS_URL: 'rediss://default:p@h:6379',
      }),
    ).not.toThrow();
  });
});
