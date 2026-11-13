import { z } from 'zod';

/**
 * État d'une dépendance d'infrastructure.
 * `not_configured` signifie que la variable d'environnement correspondante est absente :
 * on l'affiche tel quel plutôt que de prétendre que le service fonctionne.
 */
export const dependencyStatusSchema = z.enum(['up', 'down', 'not_configured']);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  environment: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.iso.datetime(),
  dependencies: z.object({
    database: dependencyStatusSchema,
    redis: dependencyStatusSchema,
  }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** `ok` uniquement si toutes les dépendances répondent. */
export function overallStatus(
  dependencies: HealthResponse['dependencies'],
): HealthResponse['status'] {
  return Object.values(dependencies).every((s) => s === 'up') ? 'ok' : 'degraded';
}
