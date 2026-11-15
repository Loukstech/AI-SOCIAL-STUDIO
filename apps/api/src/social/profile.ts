import type { SocialPlatform } from '@ass/shared';

/**
 * Lecture du profil renvoyé par chaque fournisseur (§9.2).
 *
 * Chaque plateforme nomme différemment les mêmes informations. Plutôt que
 * huit fonctions presque identiques, on décrit **où chercher** chaque champ :
 * la lecture est alors une donnée, testable plateforme par plateforme.
 */

export interface OAuthProfile {
  externalId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface FieldPaths {
  id: string[];
  username: string[];
  name: string[];
  avatar: string[];
}

/** Chemins pointés, du plus spécifique au plus générique. */
export const profilePaths: Record<SocialPlatform, FieldPaths> = {
  FACEBOOK: {
    id: ['id'],
    username: ['username', 'name'],
    name: ['name'],
    avatar: ['picture.data.url', 'picture.url'],
  },
  INSTAGRAM: {
    id: ['id', 'user_id'],
    username: ['username', 'name'],
    name: ['name', 'username'],
    avatar: ['profile_picture_url', 'picture.data.url'],
  },
  THREADS: {
    id: ['id'],
    username: ['username'],
    name: ['name', 'username'],
    avatar: ['threads_profile_picture_url', 'profile_picture_url'],
  },
  LINKEDIN: {
    id: ['sub'],
    username: ['preferred_username', 'name', 'sub'],
    name: ['name'],
    avatar: ['picture'],
  },
  X: {
    id: ['data.id'],
    username: ['data.username'],
    name: ['data.name'],
    avatar: ['data.profile_image_url'],
  },
  TIKTOK: {
    id: ['data.user.open_id', 'data.user.union_id'],
    username: ['data.user.display_name', 'data.user.open_id'],
    name: ['data.user.display_name'],
    avatar: ['data.user.avatar_url'],
  },
  YOUTUBE: {
    id: ['sub', 'id'],
    username: ['email', 'name', 'sub'],
    name: ['name'],
    avatar: ['picture'],
  },
  PINTEREST: {
    id: ['id', 'username'],
    username: ['username'],
    name: ['business_name', 'username'],
    avatar: ['profile_image'],
  },
};

function pick(payload: unknown, path: string): string | null {
  let current: unknown = payload;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' && current.trim() ? current.trim() : null;
}

function first(payload: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = pick(payload, path);
    if (value) return value;
  }
  return null;
}

/**
 * Normalise un profil. Lève une erreur explicite quand l'identifiant externe
 * manque : sans lui, aucune connexion ne peut être rattachée à un compte, et
 * créer une ligne au hasard produirait une connexion fantôme.
 */
export function extractProfile(platform: SocialPlatform, payload: unknown): OAuthProfile {
  const paths = profilePaths[platform];
  const externalId = first(payload, paths.id);
  if (!externalId) {
    throw new Error(
      `Réponse ${platform} inattendue : identifiant externe introuvable dans le profil`,
    );
  }
  const username = first(payload, paths.username) ?? externalId;
  return {
    externalId,
    username,
    displayName: first(payload, paths.name),
    avatarUrl: first(payload, paths.avatar),
  };
}
