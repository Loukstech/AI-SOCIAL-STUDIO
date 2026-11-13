import 'reflect-metadata';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { config as loadDotenv } from 'dotenv';
import { AppModule } from './app.module.js';
import { parseEnv } from './config/env.js';
import { API_PREFIX, setupApp } from './setup-app.js';
import { APP_VERSION } from './version.js';

// Le fichier .env unique vit à la racine du monorepo (absent en production : variables injectées).
loadDotenv({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });

async function bootstrap(): Promise<void> {
  const env = parseEnv(process.env);
  const app = await NestFactory.create(AppModule.forRoot(env));
  setupApp(app, env);

  const openApi = new DocumentBuilder()
    .setTitle('AI Social Studio API')
    .setVersion(APP_VERSION)
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, openApi));

  const port = env.PORT ?? env.API_PORT;
  await app.listen(port, '0.0.0.0');
  Logger.log(
    `API prête sur http://localhost:${port}/${API_PREFIX} — docs : /api/docs`,
    'Bootstrap',
  );
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
