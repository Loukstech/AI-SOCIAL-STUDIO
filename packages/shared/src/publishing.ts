import { z } from 'zod';
import { socialPlatformSchema, type SocialPlatform } from './social.js';

/** Contrats partagés du Publishing Center et du calendrier éditorial (§10, §11). */

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Date ISO attendue');

// --- Formats de publication (§10.1) ---

export const postTypes = [
  'TEXT',
  'IMAGE',
  'GALLERY',
  'VIDEO',
  'REEL',
  'SHORT',
  'CAROUSEL',
  'LINK',
] as const;
export const postTypeSchema = z.enum(postTypes);
export type PostType = (typeof postTypes)[number];

export const postTypeLabels: Record<PostType, string> = {
  TEXT: 'Texte',
  IMAGE: 'Image',
  GALLERY: 'Galerie',
  VIDEO: 'Vidéo',
  REEL: 'Reel',
  SHORT: 'Short',
  CAROUSEL: 'Carrousel',
  LINK: 'Lien',
};

// --- Cycle de vie (§10.3) ---

export const publicationStatuses = [
  'DRAFT',
  'READY_FOR_REVIEW',
  'PENDING_APPROVAL',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'REJECTED',
  'CANCELLED',
  'FAILED',
  'EXPIRED',
] as const;
export const publicationStatusSchema = z.enum(publicationStatuses);
export type PublicationStatus = (typeof publicationStatuses)[number];

export const publicationStatusLabels: Record<PublicationStatus, string> = {
  DRAFT: 'Brouillon',
  READY_FOR_REVIEW: 'Prêt pour relecture',
  PENDING_APPROVAL: 'En attente de validation',
  APPROVED: 'Validé',
  SCHEDULED: 'Programmé',
  PUBLISHING: 'Publication en cours',
  PUBLISHED: 'Publié',
  REJECTED: 'Refusé',
  CANCELLED: 'Annulé',
  FAILED: 'Échec',
  EXPIRED: 'Expiré',
};

/** États sans suite attendue. `CANCELLED` reste réouvrable en brouillon. */
export const terminalStatuses: PublicationStatus[] = ['PUBLISHED', 'CANCELLED'];

/**
 * Transitions autorisées. Toute autre combinaison est refusée par l'API :
 * une publication ne saute jamais une étape du circuit de validation.
 */
export const publicationTransitions: Record<PublicationStatus, PublicationStatus[]> = {
  DRAFT: ['READY_FOR_REVIEW', 'CANCELLED'],
  READY_FOR_REVIEW: ['PENDING_APPROVAL', 'APPROVED', 'DRAFT', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['SCHEDULED', 'PUBLISHING', 'DRAFT', 'CANCELLED'],
  SCHEDULED: ['PUBLISHING', 'APPROVED', 'CANCELLED', 'EXPIRED'],
  PUBLISHING: ['PUBLISHED', 'FAILED'],
  PUBLISHED: [],
  REJECTED: ['DRAFT', 'CANCELLED'],
  CANCELLED: ['DRAFT'],
  /**
   * `FAILED → PUBLISHED` n'existe que pour la confirmation manuelle : après un
   * échec d'envoi, l'auteur publie lui-même et fournit l'URL de chaque cible.
   * Aucune autre route ne mène de `FAILED` à `PUBLISHED` sans repasser par
   * `PUBLISHING`.
   */
  FAILED: ['SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'DRAFT', 'CANCELLED'],
  EXPIRED: ['DRAFT', 'SCHEDULED', 'CANCELLED'],
};

export function canTransition(from: PublicationStatus, to: PublicationStatus): boolean {
  return publicationTransitions[from].includes(to);
}

export const publicationModes = ['AUTO', 'APPROVAL'] as const;
export const publicationModeSchema = z.enum(publicationModes);
export type PublicationMode = (typeof publicationModes)[number];

export const publicationModeLabels: Record<PublicationMode, string> = {
  AUTO: 'Publication automatique',
  APPROVAL: 'Publication avec validation',
};

export const publicationTargetStatuses = ['PENDING', 'PUBLISHED', 'FAILED', 'SKIPPED'] as const;
export const publicationTargetStatusSchema = z.enum(publicationTargetStatuses);
export type PublicationTargetStatus = (typeof publicationTargetStatuses)[number];

/** Nombre de tentatives avant abandon définitif (§10.4). */
export const MAX_PUBLISH_ATTEMPTS = 3;

// --- Capacités des plateformes (§9.4) ---

export interface PlatformCapability {
  label: string;
  /** Formats réellement acceptés par la plateforme. */
  supports: PostType[];
  maxMedia: number;
  /** Formats pour lesquels un média est obligatoire. */
  requiresMedia: PostType[];
  /** Solution de repli quand l'API ne permet pas la publication directe. */
  fallback: 'EXPORT' | 'MANUAL' | 'DRAFT';
  note: string;
}

export const platformCapabilities: Record<SocialPlatform, PlatformCapability> = {
  FACEBOOK: {
    label: 'Facebook',
    supports: ['TEXT', 'IMAGE', 'GALLERY', 'VIDEO', 'REEL', 'LINK'],
    maxMedia: 10,
    requiresMedia: ['VIDEO', 'REEL'],
    fallback: 'EXPORT',
    note: 'Les Reels exigent une vidéo verticale.',
  },
  INSTAGRAM: {
    label: 'Instagram',
    supports: ['IMAGE', 'VIDEO', 'CAROUSEL', 'REEL'],
    maxMedia: 10,
    requiresMedia: ['IMAGE', 'VIDEO', 'CAROUSEL', 'REEL'],
    fallback: 'MANUAL',
    note: 'Aucune publication sans média : le texte seul est impossible.',
  },
  LINKEDIN: {
    label: 'LinkedIn',
    supports: ['TEXT', 'IMAGE', 'VIDEO', 'GALLERY', 'LINK'],
    maxMedia: 9,
    requiresMedia: ['VIDEO'],
    fallback: 'EXPORT',
    note: 'Le format texte long y fonctionne mieux que sur les autres réseaux.',
  },
  TIKTOK: {
    label: 'TikTok',
    supports: ['VIDEO', 'REEL'],
    maxMedia: 1,
    requiresMedia: ['VIDEO', 'REEL'],
    fallback: 'MANUAL',
    note: 'Vidéo uniquement, verticale et de 3 secondes à 10 minutes.',
  },
  YOUTUBE: {
    label: 'YouTube',
    supports: ['VIDEO', 'SHORT'],
    maxMedia: 1,
    requiresMedia: ['VIDEO', 'SHORT'],
    fallback: 'MANUAL',
    note: 'Short = vidéo verticale de 60 secondes maximum.',
  },
  X: {
    label: 'X',
    supports: ['TEXT', 'IMAGE', 'VIDEO', 'GALLERY'],
    maxMedia: 4,
    requiresMedia: ['VIDEO'],
    fallback: 'EXPORT',
    note: '280 caractères par message, 4 médias au maximum.',
  },
  PINTEREST: {
    label: 'Pinterest',
    supports: ['IMAGE', 'VIDEO', 'CAROUSEL'],
    maxMedia: 5,
    requiresMedia: ['IMAGE', 'VIDEO', 'CAROUSEL'],
    fallback: 'MANUAL',
    note: 'Épingle visuelle obligatoire, ratio 2:3 recommandé.',
  },
  THREADS: {
    label: 'Threads',
    supports: ['TEXT', 'IMAGE', 'VIDEO', 'GALLERY'],
    maxMedia: 10,
    requiresMedia: ['VIDEO'],
    fallback: 'EXPORT',
    note: '500 caractères par message, ton conversationnel.',
  },
};

/** Média autorisé pour un format donné sur une plateforme. */
export function supportsPostType(platform: SocialPlatform, postType: PostType): boolean {
  return platformCapabilities[platform].supports.includes(postType);
}

/**
 * Texte réellement envoyé à la plateforme : le corps suivi des hashtags.
 * Le décompte de caractères doit porter sur ce texte complet, sinon les limites
 * sont dépassées dès que les hashtags sont nombreux.
 */
export function composePublicationText(body: string, hashtags: string[]): string {
  const clean = hashtags.map((tag) => tag.trim()).filter(Boolean);
  return clean.length > 0 ? `${body.trimEnd()}\n\n${clean.join(' ')}` : body.trimEnd();
}

// --- Entrées ---

const targetInputSchema = z.object({
  socialAccountId: z.string().min(1),
  body: z.string().trim().min(1, 'Texte requis').max(63_206),
  title: z.string().trim().max(200).nullable().optional(),
  hashtags: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
});
export type PublicationTargetInput = z.infer<typeof targetInputSchema>;

export const createPublicationSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  postType: postTypeSchema.optional(),
  mode: publicationModeSchema.optional(),
  brandId: z.string().min(1).nullable().optional(),
  contentProjectId: z.string().min(1).nullable().optional(),
  /** Programmation immédiate si absent : la publication reste en brouillon. */
  scheduledAt: isoDate.nullable().optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  mediaIds: z.array(z.string().min(1)).max(20).optional(),
  targets: z.array(targetInputSchema).min(1, 'Au moins un compte social est requis').max(20),
});
export type CreatePublicationInput = z.infer<typeof createPublicationSchema>;

export const updatePublicationSchema = z
  .object({
    title: z.string().trim().max(200).nullable().optional(),
    postType: postTypeSchema.optional(),
    mode: publicationModeSchema.optional(),
    brandId: z.string().min(1).nullable().optional(),
    scheduledAt: isoDate.nullable().optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    mediaIds: z.array(z.string().min(1)).max(20).optional(),
    /** Remplace intégralement les cibles quand fourni. */
    targets: z.array(targetInputSchema).min(1).max(20).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Aucune modification fournie' });
export type UpdatePublicationInput = z.infer<typeof updatePublicationSchema>;

export const schedulePublicationSchema = z.object({
  scheduledAt: isoDate,
  timezone: z.string().trim().min(1).max(64).optional(),
});
export type SchedulePublicationInput = z.infer<typeof schedulePublicationSchema>;

export const rejectPublicationSchema = z.object({
  reason: z.string().trim().min(3, 'Motif requis').max(500),
});
export type RejectPublicationInput = z.infer<typeof rejectPublicationSchema>;

export const cancelPublicationSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type CancelPublicationInput = z.infer<typeof cancelPublicationSchema>;

export const duplicatePublicationSchema = z.object({
  title: z.string().trim().max(200).optional(),
});
export type DuplicatePublicationInput = z.infer<typeof duplicatePublicationSchema>;

/**
 * Confirmation d'une publication faite à la main. L'URL externe est
 * obligatoire : c'est la preuve que la publication existe réellement.
 */
export const confirmPublicationSchema = z.object({
  targets: z
    .array(
      z.object({
        targetId: z.string().min(1),
        url: z.string().url('URL externe attendue').max(2_048),
      }),
    )
    .min(1),
});
export type ConfirmPublicationInput = z.infer<typeof confirmPublicationSchema>;

// --- Vues ---

export const publicationTargetSchema = z.object({
  id: z.string(),
  socialAccountId: z.string(),
  platform: socialPlatformSchema,
  username: z.string(),
  body: z.string(),
  title: z.string().nullable(),
  hashtags: z.array(z.string()),
  status: publicationTargetStatusSchema,
  externalUrl: z.string().nullable(),
  error: z.string().nullable(),
  publishedAt: z.string().nullable(),
  charCount: z.number(),
  charLimit: z.number(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
});
export type PublicationTargetView = z.infer<typeof publicationTargetSchema>;

export const publicationEventSchema = z.object({
  id: z.string(),
  fromStatus: publicationStatusSchema.nullable(),
  toStatus: publicationStatusSchema,
  actorId: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type PublicationEvent = z.infer<typeof publicationEventSchema>;

/** Repli proposé quand la publication directe est impossible (§10.4). */
export const publicationAlternativeSchema = z.object({
  kind: z.enum(['EXPORT', 'MANUAL', 'DRAFT']),
  label: z.string(),
  detail: z.string(),
});
export type PublicationAlternative = z.infer<typeof publicationAlternativeSchema>;

export const publicationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  brandId: z.string().nullable(),
  contentProjectId: z.string().nullable(),
  title: z.string().nullable(),
  postType: postTypeSchema,
  mode: publicationModeSchema,
  status: publicationStatusSchema,
  scheduledAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  timezone: z.string(),
  attempts: z.number(),
  lastError: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  mediaIds: z.array(z.string()),
  platforms: z.array(socialPlatformSchema),
  targetCount: z.number(),
  allowedTransitions: z.array(publicationStatusSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Publication = z.infer<typeof publicationSchema>;

export const publicationDetailSchema = publicationSchema.extend({
  targets: z.array(publicationTargetSchema),
  events: z.array(publicationEventSchema),
  alternatives: z.array(publicationAlternativeSchema),
});
export type PublicationDetail = z.infer<typeof publicationDetailSchema>;

export const publicationListSchema = z.object({
  items: z.array(publicationSchema),
  total: z.number(),
});
export type PublicationList = z.infer<typeof publicationListSchema>;

export const publicationQuerySchema = z.object({
  status: publicationStatusSchema.optional(),
  platform: socialPlatformSchema.optional(),
  brandId: z.string().min(1).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PublicationQuery = z.infer<typeof publicationQuerySchema>;

/** État de la passerelle de publication, affiché dans l'interface. */
export const publishingReadinessSchema = z.object({
  ready: z.boolean(),
  kind: z.enum(['WEBHOOK', 'NONE']),
  message: z.string(),
  /**
   * Détail par plateforme (§9.4) : ce qui est accepté, ce qui bloque l'envoi,
   * et les variables à renseigner. Ne jamais supposer que tous les réseaux se
   * comportent pareil.
   */
  platforms: z.array(
    z.object({
      platform: socialPlatformSchema,
      label: z.string(),
      transport: z.enum(['WEBHOOK', 'NONE']),
      canPublish: z.boolean(),
      supports: z.array(postTypeSchema),
      fallback: z.enum(['EXPORT', 'MANUAL', 'DRAFT']),
      scopes: z.array(z.string()),
      missingCredentials: z.array(z.string()),
      note: z.string(),
    }),
  ),
});
export type PublishingReadiness = z.infer<typeof publishingReadinessSchema>;

export const publicationExportSchema = z.object({
  publicationId: z.string(),
  title: z.string().nullable(),
  postType: postTypeSchema,
  timezone: z.string(),
  targets: z.array(
    z.object({
      platform: socialPlatformSchema,
      username: z.string(),
      title: z.string().nullable(),
      text: z.string(),
      charCount: z.number(),
      charLimit: z.number(),
    }),
  ),
});
export type PublicationExport = z.infer<typeof publicationExportSchema>;

// --- Calendrier (§11) ---

export const calendarViews = ['month', 'week', 'day', 'list'] as const;
export const calendarViewSchema = z.enum(calendarViews);
export type CalendarView = (typeof calendarViews)[number];

export const calendarQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  platform: socialPlatformSchema.optional(),
  brandId: z.string().min(1).optional(),
  status: publicationStatusSchema.optional(),
});
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export const calendarEntrySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: publicationStatusSchema,
  mode: publicationModeSchema,
  postType: postTypeSchema,
  scheduledAt: z.string(),
  publishedAt: z.string().nullable(),
  platforms: z.array(socialPlatformSchema),
  brandId: z.string().nullable(),
  timezone: z.string(),
});
export type CalendarEntry = z.infer<typeof calendarEntrySchema>;

export const calendarResponseSchema = z.object({
  timezone: z.string(),
  from: z.string(),
  to: z.string(),
  entries: z.array(calendarEntrySchema),
});
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;

export const updateOrganizationTimezoneSchema = z.object({
  timezone: z.string().trim().min(1).max(64),
});
export type UpdateOrganizationTimezoneInput = z.infer<typeof updateOrganizationTimezoneSchema>;
