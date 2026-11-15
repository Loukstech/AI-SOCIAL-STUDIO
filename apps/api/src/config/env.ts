import { z } from 'zod';

const optionalUrl = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .optional();

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // PORT est injecté par la plupart des hébergeurs (Render, Koyeb, Cloud Run…).
    PORT: z.coerce.number().int().min(1).max(65535).optional(),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((v) =>
        v
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    DATABASE_URL: optionalUrl.refine((v) => v === undefined || /^postgres(ql)?:\/\//.test(v), {
      message: 'DATABASE_URL doit commencer par postgresql://',
    }),
    REDIS_URL: optionalUrl.refine((v) => v === undefined || /^rediss?:\/\//.test(v), {
      message: 'REDIS_URL doit commencer par redis:// ou rediss://',
    }),
    // Secret de signature des jetons d'authentification.
    AUTH_SECRET: z.string().min(16).optional(),
    AUTH_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
    // Base des liens d'invitation envoyés aux futurs membres.
    WEB_APP_URL: z.string().url().default('http://localhost:5173'),
    INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
    // Fournisseur de transcription. `mock` = démonstration déterministe, sans appel externe.
    AI_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
    OPENAI_API_KEY: z.string().min(10).optional(),
    // Boucle de publication : réclame les publications arrivées à échéance.
    // En production Render (une seule instance) elle tourne dans le processus API.
    PUBLISH_SCHEDULER: z.enum(['on', 'off']).default('on'),
    PUBLISH_TICK_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
    // Transport de publication. Sans adaptateur OAuth natif, un webhook permet
    // de confier l'envoi à un scénario externe (n8n, Make…). Absent = non configuré.
    PUBLISH_WEBHOOK_URL: optionalUrl.refine((v) => v === undefined || /^https?:\/\//.test(v), {
      message: 'PUBLISH_WEBHOOK_URL doit être une URL http(s)',
    }),
    PUBLISH_WEBHOOK_SECRET: z.string().min(8).optional(),
    PUBLISH_WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
    // Base publique de l'API : sert à construire l'URL de retour OAuth.
    API_PUBLIC_URL: optionalUrl.refine((v) => v === undefined || /^https?:\/\//.test(v), {
      message: 'API_PUBLIC_URL doit être une URL http(s)',
    }),
    /** Surcharge explicite de l'URL de retour OAuth (sinon dérivée). */
    OAUTH_REDIRECT_URL: optionalUrl.refine((v) => v === undefined || /^https?:\/\//.test(v), {
      message: 'OAUTH_REDIRECT_URL doit être une URL http(s)',
    }),
    OAUTH_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(10_000),
    // Identifiants d'application OAuth (§9). Absents = connexion refusée avec
    // la liste exacte des variables manquantes, jamais simulée.
    META_CLIENT_ID: z.string().min(4).optional(),
    META_CLIENT_SECRET: z.string().min(4).optional(),
    LINKEDIN_CLIENT_ID: z.string().min(4).optional(),
    LINKEDIN_CLIENT_SECRET: z.string().min(4).optional(),
    X_CLIENT_ID: z.string().min(4).optional(),
    X_CLIENT_SECRET: z.string().min(4).optional(),
    TIKTOK_CLIENT_ID: z.string().min(4).optional(),
    TIKTOK_CLIENT_SECRET: z.string().min(4).optional(),
    GOOGLE_CLIENT_ID: z.string().min(4).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(4).optional(),
    PINTEREST_CLIENT_ID: z.string().min(4).optional(),
    PINTEREST_CLIENT_SECRET: z.string().min(4).optional(),
  })
  .superRefine((env, ctx) => {
    // En développement, l'API démarre sans base ni Redis et le signale dans /health.
    // En production, leur absence est une erreur de déploiement.
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['DATABASE_URL', 'REDIS_URL', 'AUTH_SECRET'] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} est requis en production` });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('ENV');

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(racine)'} : ${i.message}`)
      .join('\n');
    throw new Error(`Configuration d'environnement invalide :\n${details}`);
  }
  return result.data;
}
