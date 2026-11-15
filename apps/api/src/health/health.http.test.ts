import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@ass/shared';
import { AppModule } from '../app.module.js';
import { parseEnv } from '../config/env.js';
import { setupApp } from '../setup-app.js';

describe('GET /api/v1/health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Aucune base ni Redis : l'API doit démarrer et le dire honnêtement.
    const env = parseEnv({ NODE_ENV: 'test', CORS_ORIGINS: 'https://app.example' });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app, env);
    await app.init();
  });

  afterAll(async () => {
    // Si `beforeAll` a échoué, `app` est indéfini : ne pas masquer l'erreur
    // réelle du démarrage par une erreur de fermeture.
    if (app) await app.close();
  });

  it('signale les dépendances non configurées sans prétendre être ok', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    const health = healthResponseSchema.parse(response.body);
    expect(health.status).toBe('degraded');
    expect(health.dependencies).toEqual({ database: 'not_configured', redis: 'not_configured' });
  });

  it("n'autorise en CORS que les origines déclarées", async () => {
    const allowed = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'https://app.example');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example');

    const refused = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example');
    expect(refused.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('ne sert rien hors du préfixe versionné', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });
});
