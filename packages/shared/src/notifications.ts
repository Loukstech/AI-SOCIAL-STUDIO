import { z } from 'zod';

/**
 * Notifications (§15).
 *
 * Le cahier des charges demande des notifications internes **et** e-mail pour
 * une liste d'événements, avec préférences par utilisateur, déduplication et
 * journal.
 *
 * Deux règles gouvernent ce module, dans la continuité du §13 :
 *
 * 1. **Un événement qu'on ne sait pas produire n'est pas notifié.** Les dix
 *    types du §15 existent dans le contrat, mais seuls ceux dont le
 *    sous-système tourne réellement sont émis. Les autres sont déclarés
 *    « non branchés » avec leur motif, dans un catalogue public — jamais une
 *    notification creuse pour faire bonne figure.
 * 2. **Un e-mail qui n'est pas parti n'est pas présenté comme parti.** Le canal
 *    e-mail conserve un statut explicite (`NO_PROVIDER` ≠ `FAILED` ≠ `SENT`).
 */

// --- Types d'événements ---

export const notificationTypeSchema = z.enum([
  'PUBLICATION_PUBLISHED',
  'PUBLICATION_FAILED',
  'APPROVAL_REQUESTED',
  'CONTENT_APPROVED',
  'CONTENT_REJECTED',
  'VIDEO_READY',
  'EXPORT_READY',
  'SOCIAL_CONNECTION_EXPIRED',
  'CREDITS_LOW',
  'PAYMENT_FAILED',
]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const notificationTypes = notificationTypeSchema.options;

export const notificationTypeLabels: Record<NotificationType, string> = {
  PUBLICATION_PUBLISHED: 'Publication réussie',
  PUBLICATION_FAILED: 'Publication échouée',
  APPROVAL_REQUESTED: 'Demande de validation',
  CONTENT_APPROVED: 'Contenu approuvé',
  CONTENT_REJECTED: 'Contenu refusé',
  VIDEO_READY: 'Vidéo terminée',
  EXPORT_READY: 'Export disponible',
  SOCIAL_CONNECTION_EXPIRED: 'Connexion sociale expirée',
  CREDITS_LOW: 'Solde de crédits faible',
  PAYMENT_FAILED: 'Échec de paiement',
};

/**
 * Catalogue des événements du §15 et de leur état réel.
 *
 * `wired` dit si l'événement peut être émis aujourd'hui. Quand il vaut `false`,
 * `reason` nomme le sous-système manquant et la section du cahier des charges
 * qui le porte. C'est la même exigence que pour l'audience au §13 : dire
 * pourquoi une donnée est absente plutôt que de la simuler.
 */
export interface NotificationCatalogEntry {
  type: NotificationType;
  label: string;
  description: string;
  /** Émis par l'application aujourd'hui ? */
  wired: boolean;
  /** Motif de la non-disponibilité, `null` quand l'événement est branché. */
  reason: string | null;
}

export const notificationCatalog: NotificationCatalogEntry[] = [
  {
    type: 'PUBLICATION_PUBLISHED',
    label: notificationTypeLabels.PUBLICATION_PUBLISHED,
    description: 'Une publication est partie sur au moins un réseau.',
    wired: true,
    reason: null,
  },
  {
    type: 'PUBLICATION_FAILED',
    label: notificationTypeLabels.PUBLICATION_FAILED,
    description: 'Une tentative de publication a échoué, avec son motif.',
    wired: true,
    reason: null,
  },
  {
    type: 'APPROVAL_REQUESTED',
    label: notificationTypeLabels.APPROVAL_REQUESTED,
    description: 'Un contenu attend la décision d’un responsable.',
    wired: true,
    reason: null,
  },
  {
    type: 'CONTENT_APPROVED',
    label: notificationTypeLabels.CONTENT_APPROVED,
    description: 'Un contenu a été approuvé par un responsable.',
    wired: true,
    reason: null,
  },
  {
    type: 'CONTENT_REJECTED',
    label: notificationTypeLabels.CONTENT_REJECTED,
    description: 'Un contenu a été refusé, avec le motif du refus.',
    wired: true,
    reason: null,
  },
  {
    type: 'SOCIAL_CONNECTION_EXPIRED',
    label: notificationTypeLabels.SOCIAL_CONNECTION_EXPIRED,
    description: 'Une connexion sociale est tombée et doit être rétablie.',
    wired: true,
    reason: null,
  },
  {
    type: 'VIDEO_READY',
    label: notificationTypeLabels.VIDEO_READY,
    description: 'Le rendu vidéo d’un projet est terminé.',
    wired: false,
    reason:
      'Aucun moteur de rendu (ffmpeg) n’est branché : un projet vidéo n’atteint jamais l’état « rendu terminé », donc l’événement n’a pas encore de source.',
  },
  {
    type: 'EXPORT_READY',
    label: notificationTypeLabels.EXPORT_READY,
    description: 'Un export est prêt à être téléchargé.',
    wired: false,
    reason:
      'Les exports sont produits de façon synchrone dans la requête (CSV, JSON, PNG côté navigateur) : il n’existe pas de file de traitement dont la fin justifierait une notification.',
  },
  {
    type: 'CREDITS_LOW',
    label: notificationTypeLabels.CREDITS_LOW,
    description: 'Le solde de crédits de l’organisation passe sous le seuil.',
    wired: false,
    reason:
      'Aucun système de crédits n’est implémenté (§16 Billing) : il n’y a pas de solde à surveiller, donc pas de seuil à franchir.',
  },
  {
    type: 'PAYMENT_FAILED',
    label: notificationTypeLabels.PAYMENT_FAILED,
    description: 'Un renouvellement ou un paiement a échoué.',
    wired: false,
    reason:
      'Aucun prestataire de paiement n’est branché (§16 Billing) : aucun renouvellement n’est tenté, donc aucun échec ne peut survenir.',
  },
];

/** Types réellement émis aujourd'hui. */
export const wiredNotificationTypes = notificationCatalog
  .filter((entry) => entry.wired)
  .map((entry) => entry.type);

/** Entrée de catalogue d'un type. */
export function catalogEntry(type: NotificationType): NotificationCatalogEntry {
  const found = notificationCatalog.find((entry) => entry.type === type);
  if (!found) throw new Error(`Type de notification inconnu : ${type}`);
  return found;
}

// --- Canaux et préférences ---

export const notificationChannelSchema = z.enum(['IN_APP', 'EMAIL']);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const notificationEmailStatusSchema = z.enum([
  'NOT_REQUESTED',
  'NO_PROVIDER',
  'SENT',
  'FAILED',
]);
export type NotificationEmailStatus = z.infer<typeof notificationEmailStatusSchema>;

export const notificationEmailStatusLabels: Record<NotificationEmailStatus, string> = {
  NOT_REQUESTED: 'E-mail non demandé',
  NO_PROVIDER: 'Aucun transport e-mail configuré',
  SENT: 'E-mail envoyé',
  FAILED: 'Envoi e-mail en échec',
};

/**
 * Préférence effective : interne activé, e-mail désactivé.
 *
 * L'e-mail est désactivé par défaut **parce qu'aucun transport n'existe**.
 * L'activer est permis et mémorisé ; la notification portera alors le statut
 * `NO_PROVIDER` avec son motif, plutôt que de laisser croire à un envoi.
 */
export const defaultPreference = { inApp: true, email: false } as const;

export const notificationPreferenceSchema = z.object({
  type: notificationTypeSchema,
  inApp: z.boolean(),
  email: z.boolean(),
  /** `true` quand la valeur vient des préférences enregistrées. */
  customized: z.boolean(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export const notificationPreferencesSchema = z.array(notificationPreferenceSchema);
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

/** Mise à jour partielle : on n'envoie que ce qui change. */
export const updatePreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        type: notificationTypeSchema,
        inApp: z.boolean().optional(),
        email: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(notificationTypes.length),
});
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

// --- Notifications ---

export const notificationSchema = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  /** Page à ouvrir depuis la notification, sans jeton ni secret. */
  url: z.string().nullable(),
  occurrences: z.number(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
  lastOccurredAt: z.string(),
  email: z.object({
    status: notificationEmailStatusSchema,
    /** Motif exact quand l'e-mail n'est pas parti. */
    reason: z.string().nullable(),
  }),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationQuerySchema = z.object({
  unread: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === true || value === 'true')),
  type: notificationTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;

export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  /** Total correspondant au filtre, pas seulement à la page courante. */
  total: z.number(),
  unread: z.number(),
  limit: z.number(),
});
export type NotificationList = z.infer<typeof notificationListSchema>;

export const unreadCountSchema = z.object({ unread: z.number() });
export type UnreadCount = z.infer<typeof unreadCountSchema>;

/** État des canaux au niveau du déploiement, affiché tel quel dans l'interface. */
export const notificationChannelsSchema = z.object({
  email: z.object({
    available: z.boolean(),
    reason: z.string().nullable(),
  }),
});
export type NotificationChannels = z.infer<typeof notificationChannelsSchema>;

export const notificationCatalogResponseSchema = notificationChannelsSchema.extend({
  events: z.array(
    z.object({
      type: notificationTypeSchema,
      label: z.string(),
      description: z.string(),
      wired: z.boolean(),
      reason: z.string().nullable(),
    }),
  ),
});
export type NotificationCatalogResponse = z.infer<typeof notificationCatalogResponseSchema>;

// --- Aides d'affichage ---

/** « 3 fois » quand l'événement s'est répété, `null` sinon. */
export function occurrencesLabel(occurrences: number): string | null {
  return occurrences > 1 ? `${occurrences} fois` : null;
}

/** Compteur lisible, plafonné : au-delà de 99 on n'affiche plus le chiffre exact. */
export function badgeLabel(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 99 ? '99+' : String(unread);
}

/**
 * Préférences complètes : une ligne par type du catalogue, valeurs par défaut
 * comprises. L'interface affiche donc toujours la même grille, qu'un réglage
 * ait été enregistré ou non.
 */
export function resolvePreferences(
  stored: { type: NotificationType; inApp: boolean; email: boolean }[],
): NotificationPreference[] {
  const byType = new Map(stored.map((row) => [row.type, row]));
  return notificationTypes.map((type) => {
    const row = byType.get(type);
    return {
      type,
      inApp: row?.inApp ?? defaultPreference.inApp,
      email: row?.email ?? defaultPreference.email,
      customized: Boolean(row),
    };
  });
}
