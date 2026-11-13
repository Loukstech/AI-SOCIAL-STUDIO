import { resolve } from 'node:path';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Le fichier .env unique vit à la racine du monorepo.
config({ path: resolve(import.meta.dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Valeur vide tolérée : `prisma generate` n'a pas besoin de base (CI, premier clone).
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
