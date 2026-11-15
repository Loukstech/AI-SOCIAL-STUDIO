import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PKCE_VERIFIER_LENGTH, socialPlatformSchema, type SocialPlatform } from '@ass/shared';

/**
 * Briques cryptographiques de la connexion OAuth (§9).
 *
 * Rien n'est stocké en base : l'état est **signé** (HMAC) et **chiffré** pour
 * ce qu'il contient de sensible, ce qui évite une table de sessions OAuth tout
 * en gardant un flux sans état côté serveur.
 */

/** Durée de vie de l'état d'autorisation : au-delà, on recommence. */
export const STATE_TTL_SECONDS = 600;

/** Vérificateur PKCE conforme au RFC 7636 : 32 octets → 43 caractères base64url. */
export function createVerifier(): string {
  const verifier = randomBytes(32).toString('base64url');
  // `base64url` produit exactement l'alphabet autorisé par le RFC.
  return verifier.slice(0, PKCE_VERIFIER_LENGTH);
}

/** Défi PKCE : `BASE64URL(SHA256(verifier))`, méthode `S256`. */
export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export interface StateInput {
  organizationId: string;
  platform: SocialPlatform;
  /** Compte existant à réautoriser. */
  socialAccountId?: string | undefined;
  brandId?: string | undefined;
  /** Vérificateur PKCE, chiffré avant d'être placé dans l'état. */
  verifier?: string | undefined;
  /** Valeur chiffrée du vérificateur, injectable pour les tests. */
  encryptedVerifier?: string | undefined;
}

export interface StatePayload {
  o: string;
  p: SocialPlatform;
  a?: string;
  b?: string;
  /** Vérificateur PKCE chiffré (AES-GCM), jamais en clair. */
  v?: string;
  n: string;
  exp: number;
}

/**
 * Encode l'état : `base64url(JSON).signature`.
 *
 * Le vérificateur PKCE y est chiffré, pas seulement signé : l'état transite par
 * le navigateur, et un vérificateur lisible dans l'URL annulerait l'intérêt de
 * PKCE pour qui intercepterait le code d'autorisation.
 */
export function createState(
  input: StateInput,
  secret: string,
  encrypt: (plain: string) => string,
  now = new Date(),
): { state: string; expiresAt: Date } {
  const expiresAt = new Date(now.getTime() + STATE_TTL_SECONDS * 1000);
  const payload: StatePayload = {
    o: input.organizationId,
    p: input.platform,
    n: randomBytes(12).toString('base64url'),
    exp: Math.floor(expiresAt.getTime() / 1000),
    ...(input.socialAccountId ? { a: input.socialAccountId } : {}),
    ...(input.brandId ? { b: input.brandId } : {}),
    ...(input.verifier ? { v: encrypt(input.verifier) } : {}),
    ...(input.encryptedVerifier ? { v: input.encryptedVerifier } : {}),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { state: `${body}.${sign(body, secret)}`, expiresAt };
}

/** Vérifie et décode l'état ; `null` si altéré, expiré ou malformé. */
export function readState(state: string, secret: string, now = new Date()): StatePayload | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];

  const expected = createHmac('sha256', secret).update(body).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
    if (!payload.o || !payload.p || !payload.n || !payload.exp) return null;
    if (payload.exp * 1000 <= now.getTime()) return null;
    // Le type de plateforme est revalidé : un état forgé ne doit pas injecter
    // une valeur hors contrat dans la suite du flux.
    socialPlatformSchema.parse(payload.p);
    return payload;
  } catch {
    return null;
  }
}
