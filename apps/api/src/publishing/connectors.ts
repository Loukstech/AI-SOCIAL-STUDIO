import type { PostType, SocialPlatform } from '@ass/shared';
import type { Env } from '../config/env.js';

/**
 * Passerelle de publication (§9.4).
 *
 * Le cahier des charges interdit de simuler une publication réussie. Tant
 * qu'aucun adaptateur OAuth n'est branché, `publish()` échoue avec un code
 * explicite et l'interface propose un repli (export, publication manuelle).
 *
 * Un transport webhook permet déjà de confier l'envoi à un scénario externe
 * (n8n, Make, Zapier) sans écrire huit adaptateurs OAuth.
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

export interface SocialConnector {
  kind: ConnectorKind;
  publish(post: SocialPost): Promise<PublishResult>;
}

const NOT_CONFIGURED_MESSAGE =
  'Aucun adaptateur de publication n’est configuré : les identifiants OAuth des plateformes sont absents. Publiez manuellement puis confirmez avec l’URL.';

function failure(code: PublishErrorCode, message: string): PublishResult {
  return { ok: false, externalId: null, externalUrl: null, error: { code, message } };
}

/** Adaptateur inerte : signale honnêtement l'absence de configuration. */
export const inertConnector: SocialConnector = {
  kind: 'NONE',
  publish: async () => failure('NOT_CONFIGURED', NOT_CONFIGURED_MESSAGE),
};

export function createWebhookConnector(env: Env): SocialConnector {
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

export function resolveConnector(env: Env): SocialConnector {
  return env.PUBLISH_WEBHOOK_URL ? createWebhookConnector(env) : inertConnector;
}

export interface ReadinessReport {
  ready: boolean;
  kind: ConnectorKind;
  message: string;
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
