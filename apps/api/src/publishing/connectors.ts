import {
  missingCredentials,
  oauthApps,
  platformCapabilities,
  platformSpecs,
  providerSpecs,
  socialPlatforms,
  type PostType,
  type SocialPlatform,
} from '@ass/shared';
import type { Env } from '../config/env.js';
import { checkTarget } from './capabilities.js';

/**
 * Adaptateurs de plateforme (§9.4).
 *
 * Le cahier des charges interdit de simuler une publication réussie. Tant
 * qu'aucun identifiant d'application n'est configuré, `publish()` échoue avec
 * un code explicite et l'interface propose un repli (export, publication
 * manuelle).
 *
 * Deux niveaux, volontairement séparés :
 *
 * - le **transport** (`SocialTransport`) : comment un envoi quitte la machine
 *   (webhook externe, ou rien du tout) ;
 * - l'**adaptateur** (`SocialConnector`) : ce que le réseau autorise réellement
 *   — capacités, validation, statut, analytics, révocation.
 *
 * Chaque méthode de l'adaptateur répond honnêtement : quand une opération n'est
 * pas possible, elle le dit avec un motif et le chemin pour la débloquer, au
 * lieu de renvoyer un succès creux.
 */

export interface SocialPost {
  platform: SocialPlatform;
  accountUsername: string;
  postType: PostType;
  /** Texte complet, hashtags compris. */
  text: string;
  title: string | null;
  mediaIds: string[];
}

export type PublishErrorCode = 'NOT_CONFIGURED' | 'TRANSPORT_ERROR' | 'REJECTED';

export interface PublishResult {
  ok: boolean;
  externalId: string | null;
  externalUrl: string | null;
  error: { code: PublishErrorCode; message: string } | null;
}

export type ConnectorKind = 'WEBHOOK' | 'NONE';

/** Opérations de l'interface commune (§9.4). */
export const connectorOperations = [
  'connect',
  'refreshToken',
  'getAccountInfo',
  'getCapabilities',
  'validatePost',
  'publish',
  'getPublishStatus',
  'getAnalytics',
  'disconnect',
] as const;
export type ConnectorOperation = (typeof connectorOperations)[number];

/** Code d'échec propre aux opérations autres que la publication. */
export type ConnectorErrorCode = 'NOT_CONFIGURED' | 'NOT_SUPPORTED' | 'TRANSPORT_ERROR';

export interface ConnectorAck {
  ok: boolean;
  code: ConnectorErrorCode | null;
  message: string | null;
}

export interface SocialAccountInfo {
  platform: SocialPlatform;
  externalId: string | null;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface ConnectorCapabilities {
  platform: SocialPlatform;
  label: string;
  supports: PostType[];
  maxMedia: number;
  requiresMedia: PostType[];
  maxChars: number;
  maxHashtags: number;
  fallback: 'EXPORT' | 'MANUAL' | 'DRAFT';
  /**
   * Un envoi de bout en bout est possible aujourd'hui : un transport est
   * configuré et l'application OAuth de la plateforme est renseignée. Ce n'est
   * pas la même chose qu'une publication directe par l'API du réseau — le
   * transport peut n'être qu'un relais externe.
   */
  canPublish: boolean;
  /** Opérations que cet adaptateur exécute réellement aujourd'hui. */
  operations: ConnectorOperation[];
  scopes: string[];
  missingCredentials: string[];
  note: string;
}

export interface ValidationResult {
  ok: boolean;
  charCount: number;
  charLimit: number;
  errors: string[];
  warnings: string[];
}

export type RemotePublishState = 'PENDING' | 'PUBLISHED' | 'FAILED' | 'UNKNOWN';

export interface PublishStatusResult {
  ok: boolean;
  state: RemotePublishState;
  externalUrl: string | null;
  message: string | null;
}

export interface AnalyticsResult {
  ok: boolean;
  /** Métriques réelles uniquement : jamais de valeurs inventées. */
  metrics: Record<string, number> | null;
  message: string | null;
}

/** Ce dont l'envoi a besoin : un transport et un état de configuration. */
export interface SocialTransport {
  kind: ConnectorKind;
  publish(post: SocialPost): Promise<PublishResult>;
}

/** Interface commune complète (§9.4), portée par une plateforme. */
export interface SocialConnector extends SocialTransport {
  platform: SocialPlatform;
  connect(): Promise<ConnectorAck>;
  refreshToken(): Promise<ConnectorAck>;
  getAccountInfo(): Promise<SocialAccountInfo | null>;
  getCapabilities(): Promise<ConnectorCapabilities>;
  validatePost(post: SocialPost): Promise<ValidationResult>;
  getPublishStatus(id: string): Promise<PublishStatusResult>;
  getAnalytics(id: string): Promise<AnalyticsResult>;
  disconnect(): Promise<ConnectorAck>;
}

const NOT_CONFIGURED_MESSAGE =
  'Aucun adaptateur de publication n’est configuré : les identifiants OAuth des plateformes sont absents. Publiez manuellement puis confirmez avec l’URL.';

function failure(code: PublishErrorCode, message: string): PublishResult {
  return { ok: false, externalId: null, externalUrl: null, error: { code, message } };
}

function ack(code: ConnectorErrorCode | null, message: string | null): ConnectorAck {
  return { ok: code === null, code, message };
}

/** Adaptateur inerte : signale honnêtement l'absence de configuration. */
export const inertConnector: SocialTransport = {
  kind: 'NONE',
  publish: async () => failure('NOT_CONFIGURED', NOT_CONFIGURED_MESSAGE),
};

export function createWebhookConnector(env: Env): SocialTransport {
  return {
    kind: 'WEBHOOK',
    async publish(post) {
      const url = env.PUBLISH_WEBHOOK_URL;
      if (!url) return failure('NOT_CONFIGURED', NOT_CONFIGURED_MESSAGE);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), env.PUBLISH_WEBHOOK_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(env.PUBLISH_WEBHOOK_SECRET
              ? { authorization: `Bearer ${env.PUBLISH_WEBHOOK_SECRET}` }
              : {}),
          },
          body: JSON.stringify({ platform: post.platform, post }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const excerpt = (await response.text().catch(() => '')).slice(0, 300);
          return failure(
            'TRANSPORT_ERROR',
            `Le transport a répondu ${response.status}${excerpt ? ` : ${excerpt}` : ''}`,
          );
        }

        const payload = (await response.json().catch(() => null)) as {
          id?: unknown;
          url?: unknown;
        } | null;
        const externalId = typeof payload?.id === 'string' ? payload.id : null;
        const externalUrl = typeof payload?.url === 'string' ? payload.url : null;

        // Une réponse 200 sans référence externe ne prouve pas la publication :
        // on refuse de la compter comme un succès.
        if (!externalId && !externalUrl) {
          return failure(
            'REJECTED',
            'Le transport a répondu sans identifiant ni URL : publication non vérifiable',
          );
        }

        return { ok: true, externalId, externalUrl, error: null };
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError';
        return failure(
          'TRANSPORT_ERROR',
          aborted
            ? `Délai de ${env.PUBLISH_WEBHOOK_TIMEOUT_MS} ms dépassé`
            : `Transport injoignable : ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function resolveConnector(env: Env): SocialTransport {
  return env.PUBLISH_WEBHOOK_URL ? createWebhookConnector(env) : inertConnector;
}

// --- Adaptateur par plateforme (§9.4) ---

/**
 * Opérations réellement exécutables avec la configuration courante.
 *
 * `validatePost` et `getCapabilities` sont toujours disponibles : ils reposent
 * sur les règles déclarées, pas sur le réseau. Les autres exigent soit un
 * transport d'envoi, soit un accès direct à l'API du fournisseur.
 */
function availableOperations(env: Env, platform: SocialPlatform): ConnectorOperation[] {
  const operations: ConnectorOperation[] = ['getCapabilities', 'validatePost'];
  if (env.PUBLISH_WEBHOOK_URL) operations.push('publish');
  const spec = providerSpecs[platform];
  // Sans identifiants d'application, même un transport externe ne peut pas
  // interroger le statut ou les statistiques du fournisseur.
  if (missingCredentials(spec, env as unknown as Record<string, string | undefined>).length === 0) {
    operations.push('connect', 'refreshToken', 'getAccountInfo', 'disconnect');
  }
  return operations;
}

/**
 * Adaptateur d'une plateforme.
 *
 * Le transport reste la seule voie d'envoi ; ce qui change d'une plateforme à
 * l'autre, ce sont les capacités, les permissions demandées et les opérations
 * possibles. Rien n'est supposé identique d'un réseau à l'autre (§9.4).
 */
export function createConnector(env: Env, platform: SocialPlatform): SocialConnector {
  const transport = resolveConnector(env);
  const capability = platformCapabilities[platform];
  const spec = providerSpecs[platform];
  const app = oauthApps[spec.app];
  const limits = platformSpecs[platform];
  const missing = missingCredentials(spec, env as unknown as Record<string, string | undefined>);
  const canPublish = env.PUBLISH_WEBHOOK_URL !== undefined && missing.length === 0;

  return {
    kind: transport.kind,
    platform,

    async getCapabilities() {
      return {
        platform,
        label: spec.label,
        supports: capability.supports,
        maxMedia: capability.maxMedia,
        requiresMedia: capability.requiresMedia,
        maxChars: limits.maxChars,
        maxHashtags: limits.maxHashtags,
        fallback: capability.fallback,
        canPublish,
        operations: availableOperations(env, platform),
        scopes: spec.scopes,
        missingCredentials: missing,
        note: capability.note,
      };
    },

    async validatePost(post) {
      const check = checkTarget({
        platform,
        postType: post.postType,
        body: post.text,
        title: post.title,
        mediaCount: post.mediaIds.length,
      });
      return {
        ok: check.errors.length === 0,
        charCount: check.charCount,
        charLimit: check.charLimit,
        errors: check.errors,
        warnings: check.warnings,
      };
    },

    publish: (post) => transport.publish(post),

    // --- Opérations hors de portée du transport ---
    //
    // La connexion vit dans `OAuthService` : elle manipule des jetons chiffrés
    // et une ligne en base, ce qu'un adaptateur sans état ne peut pas faire.
    // Ces méthodes le disent et indiquent où l'opération se trouve vraiment.

    async connect() {
      return ack(
        'NOT_SUPPORTED',
        `La connexion ${spec.label} se fait par le flux OAuth de l’application (POST /social-accounts/connect), pas par le transport d’envoi.`,
      );
    },

    async refreshToken() {
      if (!app.supportsRefresh) {
        return ack(
          'NOT_SUPPORTED',
          `${spec.label} ne délivre pas de jeton de rafraîchissement : il faut relancer la connexion.`,
        );
      }
      return ack(
        'NOT_SUPPORTED',
        `Le renouvellement ${spec.label} se fait sur le compte connecté (POST /social-accounts/:id/refresh).`,
      );
    },

    async getAccountInfo() {
      // L'identité est lue à la connexion puis conservée sur le compte, avec
      // des jetons chiffrés que cet adaptateur sans état ne détient pas.
      return null;
    },

    async getPublishStatus(id) {
      return {
        ok: false,
        state: 'UNKNOWN',
        externalUrl: null,
        message: `Le transport ${transport.kind} ne permet pas de relire l’état d’une publication (${id}) : seul un identifiant ou une URL renvoyé à l’envoi fait foi.`,
      };
    },

    async getAnalytics(id) {
      return {
        ok: false,
        metrics: null,
        message: `Aucune statistique ${spec.label} n’est disponible sans accès direct à l’API du fournisseur (publication ${id}).`,
      };
    },

    async disconnect() {
      if (missing.length > 0) {
        return ack(
          'NOT_CONFIGURED',
          `Révocation ${spec.label} impossible : renseignez ${missing.join(', ')}. Le compte reste déconnecté côté studio, mais l’autorisation subsiste chez le fournisseur.`,
        );
      }
      return ack(
        'NOT_SUPPORTED',
        `La révocation ${spec.label} se fait sur le compte connecté (DELETE /social-accounts/:id).`,
      );
    },
  };
}

// --- État de la passerelle ---

export interface ReadinessReport {
  ready: boolean;
  kind: ConnectorKind;
  message: string;
}

/** Capacités déclarées d'une plateforme, pour l'interface. */
export interface PlatformReadiness {
  platform: SocialPlatform;
  label: string;
  /** Un envoi est possible aujourd'hui, quelle que soit la voie. */
  transport: ConnectorKind;
  canPublish: boolean;
  supports: PostType[];
  fallback: 'EXPORT' | 'MANUAL' | 'DRAFT';
  scopes: string[];
  missingCredentials: string[];
  note: string;
}

/** État par plateforme : ce qui marche, ce qui bloque, et pourquoi. */
export function describePlatforms(env: Env): PlatformReadiness[] {
  return socialPlatforms.map((platform) => {
    const spec = providerSpecs[platform];
    const capability = platformCapabilities[platform];
    const missing = missingCredentials(spec, env as unknown as Record<string, string | undefined>);
    return {
      platform,
      label: spec.label,
      transport: env.PUBLISH_WEBHOOK_URL ? 'WEBHOOK' : 'NONE',
      canPublish: Boolean(env.PUBLISH_WEBHOOK_URL) && missing.length === 0,
      supports: capability.supports,
      fallback: capability.fallback,
      scopes: spec.scopes,
      missingCredentials: missing,
      note: capability.note,
    };
  });
}

/** Exposé à l'interface pour expliquer pourquoi publier échouera. */
export function describeReadiness(env: Env): ReadinessReport {
  if (env.PUBLISH_WEBHOOK_URL) {
    return {
      ready: true,
      kind: 'WEBHOOK',
      message:
        'Publication déléguée à un transport externe. Chaque envoi exige un identifiant ou une URL en retour.',
    };
  }
  return { ready: false, kind: 'NONE', message: NOT_CONFIGURED_MESSAGE };
}
