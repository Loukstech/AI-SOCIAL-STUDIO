import { z } from 'zod';
import { socialPlatformSchema, type SocialPlatform } from './social.js';

/**
 * Connexion des comptes sociaux (§9).
 *
 * Ce fichier ne contient **que des données et des fonctions pures** : les
 * points d'entrée OAuth de chaque fournisseur, les permissions demandées, et la
 * logique d'URL. Aucun secret, aucun appel réseau.
 *
 * Les URL sont celles de la documentation officielle (référencée par
 * `docsUrl`). Elles peuvent être surchargées par l'exploitant sans toucher au
 * code, et les identifiants d'application sont lus dans l'environnement : sans
 * eux, la connexion est refusée avec la liste exacte des variables manquantes,
 * jamais simulée.
 */

/** Application OAuth : un identifiant client peut couvrir plusieurs plateformes. */
export type OAuthAppKey = 'META' | 'LINKEDIN' | 'X' | 'TIKTOK' | 'GOOGLE' | 'PINTEREST';

export interface OAuthApp {
  label: string;
  /** Page d'autorisation vers laquelle rediriger l'utilisateur. */
  authorizeUrl: string;
  /** Échange du code contre un jeton, puis renouvellement. */
  tokenUrl: string;
  /** Profil du compte connecté (§9.2 : nom, avatar, identifiant externe). */
  infoUrl: string;
  usesPkce: boolean;
  requiresSecret: boolean;
  supportsRefresh: boolean;
  /** Documentation officielle du flux. */
  docsUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
}

/**
 * Points d'entrée par application. Meta utilise un endpoint non versionné :
 * c'est volontaire, `graph.facebook.com/oauth/access_token` suit la version
 * par défaut de l'application et évite de coder en dur un numéro de version
 * qui périme.
 */
export const oauthApps: Record<OAuthAppKey, OAuthApp> = {
  META: {
    label: 'Meta',
    authorizeUrl: 'https://www.facebook.com/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/oauth/access_token',
    infoUrl: 'https://graph.facebook.com/me',
    usesPkce: false,
    requiresSecret: true,
    // Meta échange un jeton court contre un jeton long : pas de refresh_token.
    supportsRefresh: false,
    docsUrl: 'https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow',
    clientIdEnv: 'META_CLIENT_ID',
    clientSecretEnv: 'META_CLIENT_SECRET',
  },
  LINKEDIN: {
    label: 'LinkedIn',
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    infoUrl: 'https://api.linkedin.com/v2/userinfo',
    usesPkce: true,
    requiresSecret: true,
    supportsRefresh: true,
    docsUrl:
      'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow',
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
  },
  X: {
    label: 'X',
    authorizeUrl: 'https://x.com/i/oauth2/authorize',
    tokenUrl: 'https://api.x.com/2/oauth2/token',
    infoUrl: 'https://api.x.com/2/users/me',
    // X impose PKCE, y compris pour les clients confidentiels.
    usesPkce: true,
    requiresSecret: true,
    supportsRefresh: true,
    docsUrl:
      'https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code',
    clientIdEnv: 'X_CLIENT_ID',
    clientSecretEnv: 'X_CLIENT_SECRET',
  },
  TIKTOK: {
    label: 'TikTok',
    authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    infoUrl: 'https://open.tiktokapis.com/v2/user/info/',
    usesPkce: true,
    requiresSecret: true,
    supportsRefresh: true,
    docsUrl: 'https://developers.tiktok.com/doc/oauth-user-access-token-management',
    clientIdEnv: 'TIKTOK_CLIENT_ID',
    clientSecretEnv: 'TIKTOK_CLIENT_SECRET',
  },
  GOOGLE: {
    label: 'Google (YouTube)',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    infoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    usesPkce: true,
    requiresSecret: true,
    supportsRefresh: true,
    docsUrl: 'https://developers.google.com/identity/protocols/oauth2/web-server',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
  },
  PINTEREST: {
    label: 'Pinterest',
    authorizeUrl: 'https://www.pinterest.com/oauth/',
    tokenUrl: 'https://api.pinterest.com/v5/oauth/token',
    infoUrl: 'https://api.pinterest.com/v5/user_account',
    usesPkce: false,
    requiresSecret: true,
    supportsRefresh: true,
    docsUrl: 'https://developers.pinterest.com/docs/getting-started/authentication/',
    clientIdEnv: 'PINTEREST_CLIENT_ID',
    clientSecretEnv: 'PINTEREST_CLIENT_SECRET',
  },
};

export interface ProviderSpec {
  app: OAuthAppKey;
  label: string;
  /** Permissions demandées à l'autorisation. */
  scopes: string[];
  /**
   * Certaines plateformes n'acceptent pas la publication directe sans revue
   * préalable de l'application : c'est une propriété du compte, pas du code.
   */
  note: string | null;
}

export const providerSpecs: Record<SocialPlatform, ProviderSpec> = {
  FACEBOOK: {
    app: 'META',
    label: 'Facebook Pages',
    scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
    note: 'La publication vise une Page, jamais un profil personnel.',
  },
  INSTAGRAM: {
    app: 'META',
    label: 'Instagram Professional',
    scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
    note: 'Un compte professionnel relié à une Page est requis.',
  },
  THREADS: {
    app: 'META',
    label: 'Threads',
    scopes: ['threads_basic', 'threads_content_publish'],
    note: 'Le compte Threads doit être relié au compte Instagram professionnel.',
  },
  LINKEDIN: {
    app: 'LINKEDIN',
    label: 'LinkedIn',
    scopes: ['openid', 'profile', 'w_member_social'],
    note: 'Publier sur une Page d’entreprise demande en plus r_organization_social et w_organization_social.',
  },
  X: {
    app: 'X',
    label: 'X',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    note: 'offline.access est indispensable pour obtenir un refresh token.',
  },
  TIKTOK: {
    app: 'TIKTOK',
    label: 'TikTok',
    // Login Kit uniquement : l'application lit le profil du compte connecté.
    // `video.publish` (Content Posting API) est volontairement absent tant que
    // TikTok n'a pas validé la publication directe. La publication retombe
    // alors sur l'export manuel (voir `platformCapabilities.TIKTOK.fallback`).
    scopes: ['user.info.basic'],
    note: 'La publication directe est soumise à validation par TikTok.',
  },
  YOUTUBE: {
    app: 'GOOGLE',
    label: 'YouTube',
    scopes: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
    ],
    note: 'L’envoi de vidéos utilise l’API Data v3 en upload résumable.',
  },
  PINTEREST: {
    app: 'PINTEREST',
    label: 'Pinterest',
    scopes: ['pins:read', 'pins:write', 'boards:read'],
    note: 'Chaque épingle doit viser un tableau existant.',
  },
};

// --- PKCE (RFC 7636) ---

/**
 * Vérificateur PKCE : 43 à 128 caractères parmi `[A-Za-z0-9-._~]`.
 * 32 octets aléatoires encodés en base64url donnent 43 caractères.
 */
export const PKCE_VERIFIER_LENGTH = 43;

/** Un vérificateur est-il conforme au format attendu ? */
export function isPkceVerifier(value: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(value);
}

// --- Construction d'URL (pure) ---

export interface AuthorizationParams {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
  codeChallenge?: string;
  /** Paramètres supplémentaires propres à un fournisseur. */
  extra?: Record<string, string>;
}

/**
 * Ajoute des paramètres de requête sans dépendre de `URL` : ce module est
 * partagé par le navigateur et le serveur, il ne doit dépendre d'aucun runtime.
 */
function withQuery(base: string, params: Array<[string, string]>): string {
  const hashIndex = base.indexOf('#');
  const beforeHash = hashIndex === -1 ? base : base.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : base.slice(hashIndex);
  const query = params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  if (!query) return base;
  const separator = beforeHash.includes('?') ? '&' : '?';
  return `${beforeHash}${separator}${query}${hash}`;
}

/**
 * Construit l'URL d'autorisation. `code_challenge_method=S256` n'est ajouté
 * que si un défi est fourni : l'envoyer sans défi casse certains fournisseurs.
 */
export function authorizationUrl(app: OAuthApp, params: AuthorizationParams): string {
  const entries: Array<[string, string]> = [
    ['response_type', 'code'],
    ['client_id', params.clientId],
    ['redirect_uri', params.redirectUri],
    ['state', params.state],
  ];
  if (params.scopes.length > 0) {
    // Google attend une liste séparée par des espaces, les autres une virgule
    // ou un espace : l'espace est accepté partout.
    entries.push(['scope', params.scopes.join(' ')]);
  }
  if (params.codeChallenge) {
    entries.push(['code_challenge', params.codeChallenge]);
    entries.push(['code_challenge_method', 'S256']);
  }
  for (const [key, value] of Object.entries(params.extra ?? {})) entries.push([key, value]);
  return withQuery(app.authorizeUrl, entries);
}

/** Variables d'environnement manquantes pour ouvrir une connexion. */
export function missingCredentials(
  spec: ProviderSpec,
  env: Record<string, string | undefined>,
): string[] {
  const app = oauthApps[spec.app];
  const missing: string[] = [];
  if (!env[app.clientIdEnv]?.trim()) missing.push(app.clientIdEnv);
  if (app.requiresSecret && !env[app.clientSecretEnv]?.trim()) missing.push(app.clientSecretEnv);
  return missing;
}

// --- État de connexion (§9.2 / §9.3) ---

export const connectionStates = [
  'OK',
  'EXPIRING',
  'EXPIRED',
  'NO_TOKEN',
  'ERROR',
  'REVOKED',
] as const;
export const connectionStateSchema = z.enum(connectionStates);
export type ConnectionState = (typeof connectionStates)[number];

/** Seuil au-delà duquel une connexion est signalée comme bientôt expirée. */
export const EXPIRING_WINDOW_HOURS = 72;

export interface ConnectionAssessment {
  state: ConnectionState;
  /** Message actionnable, `null` quand tout va bien. */
  guidance: string | null;
  /** Heures restantes avant expiration, `null` sans date connue. */
  hoursLeft: number | null;
}

/**
 * Qualifie une connexion à partir de son état stocké. Fonction pure : la même
 * règle sert à l'API, à l'interface et aux tests.
 */
export function assessConnection(input: {
  status: string;
  hasAccessToken: boolean;
  tokenExpiresAt: string | Date | null;
  lastErrorAt?: string | Date | null;
  now?: Date;
}): ConnectionAssessment {
  const now = input.now ?? new Date();

  if (input.status === 'REVOKED') {
    return {
      state: 'REVOKED',
      guidance: 'Compte déconnecté : reconnectez-le pour publier.',
      hoursLeft: null,
    };
  }
  if (!input.hasAccessToken) {
    return {
      state: 'NO_TOKEN',
      guidance: 'Aucun jeton enregistré : lancez la connexion au compte.',
      hoursLeft: null,
    };
  }

  const expiry = input.tokenExpiresAt ? new Date(input.tokenExpiresAt) : null;
  const hoursLeft =
    expiry === null ? null : Math.round(((expiry.getTime() - now.getTime()) / 3_600_000) * 10) / 10;

  if (hoursLeft !== null && hoursLeft <= 0) {
    return {
      state: 'EXPIRED',
      guidance: 'Jeton expiré : renouvelez l’autorisation avant de publier.',
      hoursLeft,
    };
  }
  if (input.lastErrorAt) {
    return {
      state: 'ERROR',
      guidance:
        'La dernière synchronisation a échoué : vérifiez les permissions, puis reconnectez si nécessaire.',
      hoursLeft,
    };
  }
  if (hoursLeft !== null && hoursLeft <= EXPIRING_WINDOW_HOURS) {
    return {
      state: 'EXPIRING',
      guidance: 'Le jeton expire bientôt : renouvelez-le pour éviter une coupure.',
      hoursLeft,
    };
  }
  return { state: 'OK', guidance: null, hoursLeft };
}

// --- Contrats d'API ---

export const connectRequestSchema = z.object({
  platform: socialPlatformSchema,
  /** Compte existant à réautoriser ; absent = nouvelle connexion. */
  socialAccountId: z.string().min(1).optional(),
  brandId: z.string().min(1).optional(),
});
export type ConnectRequestInput = z.infer<typeof connectRequestSchema>;

export const connectResultSchema = z.object({
  platform: socialPlatformSchema,
  authorizationUrl: z.string().url(),
  /** Horodatage d'expiration de l'état signé. */
  expiresAt: z.string(),
  scopes: z.array(z.string()),
  usesPkce: z.boolean(),
});
export type ConnectResult = z.infer<typeof connectResultSchema>;

export const connectionHealthSchema = z.object({
  id: z.string(),
  platform: socialPlatformSchema,
  username: z.string(),
  state: connectionStateSchema,
  guidance: z.string().nullable(),
  hoursLeft: z.number().nullable(),
  scopes: z.array(z.string()),
  tokenExpiresAt: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
  hasAccessToken: z.boolean(),
  hasRefreshToken: z.boolean(),
  supportsRefresh: z.boolean(),
  /** Identifiants d'application manquants pour ce fournisseur. */
  missingCredentials: z.array(z.string()),
});
export type ConnectionHealth = z.infer<typeof connectionHealthSchema>;

/** Réponse d'un renouvellement refusé faute de jeton de rafraîchissement. */
export const refreshUnavailableSchema = z.object({
  message: z.string(),
  canRefresh: z.boolean(),
  reason: z.string(),
});
