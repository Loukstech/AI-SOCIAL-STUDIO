import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { Env } from './config/env.js';

export const API_PREFIX = 'api/v1';

/** Configuration HTTP commune au serveur réel et aux tests d'intégration. */
export function setupApp(app: INestApplication, env: Env): void {
  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization-Id'],
  });
  app.enableShutdownHooks();
}
