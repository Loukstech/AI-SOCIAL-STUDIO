import { healthResponseSchema, type HealthResponse } from '@ass/shared';

export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${API_URL}/api/v1/health`, { signal });
  if (!response.ok) {
    throw new Error(`L'API a répondu ${response.status}`);
  }
  // La réponse est validée : une API incompatible est traitée comme une erreur, pas affichée à moitié.
  return healthResponseSchema.parse(await response.json());
}
