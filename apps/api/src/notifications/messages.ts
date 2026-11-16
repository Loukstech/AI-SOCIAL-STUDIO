import { notificationTypeLabels, type NotificationType } from '@ass/shared';

/**
 * Rédaction des notifications.
 *
 * Fonctions pures : le texte d'une notification est une donnée comme une autre,
 * il se teste. Rien n'y est inventé — quand une information manque (titre
 * absent, motif d'erreur inconnu), le message le dit au lieu de combler.
 */

/** Longueur maximale d'un titre repris dans le corps du message. */
const TITLE_MAX = 80;

/** Reprend un titre de publication sans le tronquer en plein mot. */
export function shortTitle(title: string | null): string {
  if (!title || title.trim().length === 0) return 'Publication sans titre';
  const clean = title.trim().replace(/\s+/g, ' ');
  if (clean.length <= TITLE_MAX) return clean;
  const cut = clean.slice(0, TITLE_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export interface PublicationMessageInput {
  title: string | null;
  /** Libellés des réseaux visés, dans l'ordre des cibles. */
  platforms: string[];
  /** Motif d'échec, `null` quand il n'y en a pas. */
  error?: string | null;
  /** Motif de refus, `null` quand il n'y en a pas. */
  reason?: string | null;
}

export interface NotificationMessage {
  title: string;
  body: string;
  /** Ancre de page à ouvrir depuis la notification. */
  url: string | null;
}

function joinPlatforms(platforms: string[]): string {
  const unique = [...new Set(platforms)];
  if (unique.length === 0) return 'aucun réseau';
  if (unique.length === 1) return unique[0]!;
  return `${unique.slice(0, -1).join(', ')} et ${unique.at(-1)}`;
}

/** Message d'une notification liée à une publication. */
export function publicationMessage(
  type: NotificationType,
  input: PublicationMessageInput,
): NotificationMessage {
  const title = shortTitle(input.title);
  const networks = joinPlatforms(input.platforms);

  switch (type) {
    case 'PUBLICATION_PUBLISHED':
      return {
        title: 'Publication envoyée',
        body: `« ${title} » est partie sur ${networks}.`,
        url: '#publishing',
      };
    case 'PUBLICATION_FAILED':
      return {
        title: 'Publication échouée',
        body: input.error
          ? `« ${title} » n’a pas pu partir sur ${networks} : ${input.error}`
          : `« ${title} » n’a pas pu partir sur ${networks}. Le motif n’a pas été fourni par la plateforme.`,
        url: '#publishing',
      };
    case 'APPROVAL_REQUESTED':
      return {
        title: 'Validation demandée',
        body: `« ${title} » attend une décision avant de partir sur ${networks}.`,
        url: '#publishing',
      };
    case 'CONTENT_APPROVED':
      return {
        title: 'Contenu approuvé',
        body: `« ${title} » a été approuvé et peut être programmé sur ${networks}.`,
        url: '#publishing',
      };
    case 'CONTENT_REJECTED':
      return {
        title: 'Contenu refusé',
        body: input.reason
          ? `« ${title} » a été refusé : ${input.reason}`
          : `« ${title} » a été refusé. Aucun motif n’a été saisi.`,
        url: '#publishing',
      };
    default:
      throw new Error(`Type de notification non lié à une publication : ${type}`);
  }
}

export interface SocialMessageInput {
  platformLabel: string;
  username: string;
  /** Motif exact remonté par la synchronisation ou le renouvellement. */
  error: string | null;
}

/** Message d'une connexion sociale tombée (§9.3 → §15). */
export function socialExpiredMessage(input: SocialMessageInput): NotificationMessage {
  return {
    title: `Connexion ${input.platformLabel} à rétablir`,
    body: input.error
      ? `La connexion @${input.username} sur ${input.platformLabel} est tombée : ${input.error}`
      : `La connexion @${input.username} sur ${input.platformLabel} est tombée. Reconnectez le compte pour reprendre les publications.`,
    url: '#social',
  };
}

/**
 * Clé de déduplication d'un événement.
 *
 * Volontairement **sans horodatage** : deux échecs successifs de la même
 * publication doivent se cumuler sur une seule ligne (avec un compteur), pas
 * remplir la boîte de doublons. C'est la déduplication demandée au §15.
 */
export function dedupeKeyFor(
  scope: 'publication' | 'social',
  entityId: string,
  event: string,
): string {
  return `${scope}:${entityId}:${event}`;
}

/** Clé de déduplication associée à un changement d'état de publication. */
export function publicationDedupeKey(publicationId: string, type: NotificationType): string | null {
  switch (type) {
    case 'PUBLICATION_PUBLISHED':
      return dedupeKeyFor('publication', publicationId, 'published');
    case 'PUBLICATION_FAILED':
      return dedupeKeyFor('publication', publicationId, 'failed');
    case 'APPROVAL_REQUESTED':
      return dedupeKeyFor('publication', publicationId, 'approval');
    case 'CONTENT_APPROVED':
      return dedupeKeyFor('publication', publicationId, 'approved');
    case 'CONTENT_REJECTED':
      return dedupeKeyFor('publication', publicationId, 'rejected');
    default:
      return null;
  }
}

/** Sujet et corps de l'e-mail : même contenu, mise en forme propre au canal. */
export function mailBody(message: NotificationMessage, type: NotificationType): MailDraft {
  return {
    subject: `[AI Social Studio] ${message.title}`,
    text: [
      message.body,
      '',
      `Type : ${notificationTypeLabels[type]}`,
      'Vous recevez cet e-mail parce que vous avez activé ce type de notification.',
      'Modifiable dans AI Social Studio → Notifications → Préférences.',
    ].join('\n'),
  };
}

export interface MailDraft {
  subject: string;
  text: string;
}
