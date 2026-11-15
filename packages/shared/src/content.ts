import { z } from 'zod';
import { socialPlatformSchema, type SocialPlatform } from './social.js';

/** Contrats partagés du AI Content Studio (§6). */

export const contentTypes = [
  'PROMO',
  'ANNOUNCEMENT',
  'PROMOTION',
  'COMPANY_INTRO',
  'QUOTE',
  'TIP',
  'TUTORIAL',
  'TESTIMONIAL',
  'PRODUCT_LAUNCH',
  'EVENT',
  'SPECIAL_OFFER',
  'EDUCATIONAL',
  'VIDEO_SCRIPT',
  'CAROUSEL',
] as const;
export const contentTypeSchema = z.enum(contentTypes);
export type ContentType = (typeof contentTypes)[number];

export const contentTypeLabels: Record<ContentType, string> = {
  PROMO: 'Publication commerciale',
  ANNOUNCEMENT: 'Annonce',
  PROMOTION: 'Promotion',
  COMPANY_INTRO: 'Présentation d’entreprise',
  QUOTE: 'Citation',
  TIP: 'Astuce',
  TUTORIAL: 'Tutoriel',
  TESTIMONIAL: 'Témoignage',
  PRODUCT_LAUNCH: 'Lancement de produit',
  EVENT: 'Événement',
  SPECIAL_OFFER: 'Offre spéciale',
  EDUCATIONAL: 'Contenu éducatif',
  VIDEO_SCRIPT: 'Script vidéo',
  CAROUSEL: 'Carrousel',
};

export const contentTones = [
  'PROFESSIONAL',
  'DYNAMIC',
  'FRIENDLY',
  'EXPERT',
  'INSPIRING',
  'PLAYFUL',
] as const;
export const contentToneSchema = z.enum(contentTones);
export type ContentTone = (typeof contentTones)[number];

export const contentToneLabels: Record<ContentTone, string> = {
  PROFESSIONAL: 'Professionnel',
  DYNAMIC: 'Dynamique',
  FRIENDLY: 'Chaleureux',
  EXPERT: 'Expert',
  INSPIRING: 'Inspirant',
  PLAYFUL: 'Ludique',
};

export const contentLanguages = ['FR', 'EN'] as const;
export const contentLanguageSchema = z.enum(contentLanguages);
export type ContentLanguage = (typeof contentLanguages)[number];

/** Actions de l'assistant rédactionnel (§6.4). */
export const rewriteActions = [
  'REPHRASE',
  'FIX',
  'SHORTEN',
  'EXPAND',
  'CHANGE_TONE',
  'ADD_CTA',
  'HASHTAGS',
  'TRANSLATE',
  'VARIATIONS',
] as const;
export const rewriteActionSchema = z.enum(rewriteActions);
export type RewriteAction = (typeof rewriteActions)[number];

export const rewriteActionLabels: Record<RewriteAction, string> = {
  REPHRASE: 'Reformuler',
  FIX: 'Corriger',
  SHORTEN: 'Raccourcir',
  EXPAND: 'Développer',
  CHANGE_TONE: 'Changer le ton',
  ADD_CTA: 'Ajouter un appel à l’action',
  HASHTAGS: 'Proposer des hashtags',
  TRANSLATE: 'Traduire',
  VARIATIONS: 'Générer des variantes',
};

/**
 * Règles des plateformes (§6.3). `maxChars` est la limite dure imposée par la
 * plateforme, `recommendedChars` la longueur visée pour rester lisible.
 */
export interface PlatformSpec {
  label: string;
  maxChars: number;
  recommendedChars: number;
  maxHashtags: number;
  /** Longueur maximale du titre, quand la plateforme en possède un. */
  titleMaxChars?: number;
  /** Décrit le registre attendu, utilisé par le générateur et l'interface. */
  guidance: string;
}

export const platformSpecs: Record<SocialPlatform, PlatformSpec> = {
  FACEBOOK: {
    label: 'Facebook',
    maxChars: 63_206,
    recommendedChars: 600,
    maxHashtags: 3,
    guidance: 'Texte détaillé et appel à l’action explicite.',
  },
  INSTAGRAM: {
    label: 'Instagram',
    maxChars: 2_200,
    recommendedChars: 400,
    maxHashtags: 10,
    guidance: 'Accroche visuelle, texte court et hashtags.',
  },
  LINKEDIN: {
    label: 'LinkedIn',
    maxChars: 3_000,
    recommendedChars: 700,
    maxHashtags: 5,
    guidance: 'Ton professionnel et informatif, angle métier.',
  },
  TIKTOK: {
    label: 'TikTok',
    maxChars: 2_200,
    recommendedChars: 150,
    maxHashtags: 5,
    guidance: 'Description courte et directe.',
  },
  YOUTUBE: {
    label: 'YouTube',
    maxChars: 5_000,
    recommendedChars: 600,
    maxHashtags: 5,
    titleMaxChars: 100,
    guidance: 'Titre, description et hashtags.',
  },
  X: {
    label: 'X',
    maxChars: 280,
    recommendedChars: 240,
    maxHashtags: 2,
    guidance: 'Message dense, une seule idée.',
  },
  PINTEREST: {
    label: 'Pinterest',
    maxChars: 500,
    recommendedChars: 300,
    maxHashtags: 5,
    titleMaxChars: 100,
    guidance: 'Description inspirante, orientée découverte.',
  },
  THREADS: {
    label: 'Threads',
    maxChars: 500,
    recommendedChars: 280,
    maxHashtags: 3,
    guidance: 'Ton conversationnel, sans surcharge.',
  },
};

export const generateContentSchema = z.object({
  brief: z
    .string()
    .trim()
    .min(20, 'Décrivez votre besoin en 20 caractères minimum')
    .max(4000, 'Brief trop long (4000 caractères maximum)'),
  platforms: z
    .array(socialPlatformSchema)
    .min(1, 'Sélectionnez au moins une plateforme')
    .max(8)
    .refine((values) => new Set(values).size === values.length, {
      message: 'Plateformes en double',
    }),
  contentType: contentTypeSchema.default('PROMO'),
  tone: contentToneSchema.default('PROFESSIONAL'),
  language: contentLanguageSchema.default('FR'),
  brandId: z.string().min(1).optional(),
  objective: z.string().trim().max(200).optional(),
  audience: z.string().trim().max(200).optional(),
});
export type GenerateContentInput = z.infer<typeof generateContentSchema>;

export const contentVariantSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  platform: socialPlatformSchema,
  language: contentLanguageSchema,
  title: z.string().nullable(),
  body: z.string(),
  hashtags: z.array(z.string()),
  callToAction: z.string().nullable(),
  charCount: z.number(),
  warnings: z.array(z.string()),
  edited: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContentVariant = z.infer<typeof contentVariantSchema>;

export const contentProjectSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  brandId: z.string().nullable(),
  brief: z.string(),
  subject: z.string().nullable(),
  objective: z.string().nullable(),
  audience: z.string().nullable(),
  tone: contentToneSchema,
  contentType: contentTypeSchema,
  language: contentLanguageSchema,
  provider: z.string(),
  variantCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContentProject = z.infer<typeof contentProjectSchema>;

export const contentProjectDetailSchema = contentProjectSchema.extend({
  variants: z.array(contentVariantSchema),
});
export type ContentProjectDetail = z.infer<typeof contentProjectDetailSchema>;

export const updateVariantSchema = z
  .object({
    title: z.string().trim().max(200).nullable().optional(),
    body: z.string().trim().min(1, 'Le texte ne peut pas être vide').max(63_206).optional(),
    hashtags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    callToAction: z.string().trim().max(200).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Aucune modification fournie' });
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;

export const rewriteVariantSchema = z.object({
  action: rewriteActionSchema,
  tone: contentToneSchema.optional(),
  language: contentLanguageSchema.optional(),
});
export type RewriteVariantInput = z.infer<typeof rewriteVariantSchema>;
