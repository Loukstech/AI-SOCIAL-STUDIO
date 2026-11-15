import { z } from 'zod';
import { socialPlatformSchema, type SocialPlatform } from './social.js';

/**
 * AI Image Studio (§7).
 *
 * Le moteur livré est un composeur SVG déterministe : il produit une vraie
 * image vectorielle, reproductible à partir d'une graine, dont les textes
 * restent des calques modifiables. Un modèle de génération raster branché plus
 * tard implémentera la même interface sans changer les contrats ci-dessous.
 */

export interface ImageFormatSpec {
  label: string;
  width: number;
  height: number;
  /** Rapport largeur/hauteur, utilisé pour rapprocher un format personnalisé. */
  ratio: number;
}

export const imageFormats = [
  'SQUARE',
  'PORTRAIT_4_5',
  'STORY_9_16',
  'LANDSCAPE_16_9',
  'CUSTOM',
] as const;
export const imageFormatSchema = z.enum(imageFormats);
export type ImageFormat = (typeof imageFormats)[number];

export const imageFormatSpecs: Record<Exclude<ImageFormat, 'CUSTOM'>, ImageFormatSpec> = {
  SQUARE: { label: 'Carré 1:1', width: 1080, height: 1080, ratio: 1 },
  PORTRAIT_4_5: { label: 'Portrait 4:5', width: 1080, height: 1350, ratio: 0.8 },
  STORY_9_16: { label: 'Story 9:16', width: 1080, height: 1920, ratio: 0.5625 },
  LANDSCAPE_16_9: { label: 'Paysage 16:9', width: 1920, height: 1080, ratio: 16 / 9 },
};

export const imageFormatLabels: Record<ImageFormat, string> = {
  SQUARE: 'Carré 1:1',
  PORTRAIT_4_5: 'Portrait 4:5',
  STORY_9_16: 'Story 9:16',
  LANDSCAPE_16_9: 'Paysage 16:9',
  CUSTOM: 'Personnalisé',
};

export const imageStyles = ['EDITORIAL', 'BOLD', 'MINIMAL', 'GRADIENT'] as const;
export const imageStyleSchema = z.enum(imageStyles);
export type ImageStyle = (typeof imageStyles)[number];

export const imageStyleLabels: Record<ImageStyle, string> = {
  EDITORIAL: 'Éditorial',
  BOLD: 'Affirmé',
  MINIMAL: 'Minimal',
  GRADIENT: 'Dégradé',
};

export const MIN_IMAGE_SIDE = 256;
export const MAX_IMAGE_SIDE = 4096;

/** Formats qu'une plateforme accepte réellement pour un visuel. */
export const platformImageFormats: Record<SocialPlatform, ImageFormat[]> = {
  INSTAGRAM: ['SQUARE', 'PORTRAIT_4_5', 'STORY_9_16'],
  FACEBOOK: ['SQUARE', 'PORTRAIT_4_5', 'STORY_9_16', 'LANDSCAPE_16_9'],
  LINKEDIN: ['SQUARE', 'LANDSCAPE_16_9'],
  X: ['SQUARE', 'LANDSCAPE_16_9'],
  YOUTUBE: ['LANDSCAPE_16_9'],
  TIKTOK: ['STORY_9_16'],
  PINTEREST: ['PORTRAIT_4_5'],
  THREADS: ['SQUARE', 'PORTRAIT_4_5'],
};

export function resolveDimensions(
  format: ImageFormat,
  width?: number | undefined,
  height?: number | undefined,
): { width: number; height: number } {
  if (format === 'CUSTOM') {
    return { width: width ?? 1080, height: height ?? 1080 };
  }
  const spec = imageFormatSpecs[format];
  return { width: spec.width, height: spec.height };
}

/** Format prédéfini le plus proche d'un rapport donné, à 4 % près. */
export function nearestFormat(
  width: number,
  height: number,
): Exclude<ImageFormat, 'CUSTOM'> | null {
  const ratio = width / height;
  let best: { format: Exclude<ImageFormat, 'CUSTOM'>; delta: number } | null = null;
  for (const [format, spec] of Object.entries(imageFormatSpecs) as Array<
    [Exclude<ImageFormat, 'CUSTOM'>, ImageFormatSpec]
  >) {
    const delta = Math.abs(ratio - spec.ratio) / spec.ratio;
    if (best === null || delta < best.delta) best = { format, delta };
  }
  return best && best.delta <= 0.04 ? best.format : null;
}

/**
 * Vérifie qu'un visuel respecte les règles de la plateforme visée (§8 :
 * le Brand Kit ne doit pas imposer un élément incompatible).
 */
export function checkPlatformFormat(
  platform: SocialPlatform,
  format: ImageFormat,
  width: number,
  height: number,
): string | null {
  const allowed = platformImageFormats[platform];
  const effective = format === 'CUSTOM' ? nearestFormat(width, height) : format;
  if (effective === null) {
    return `Dimensions ${width}×${height} sans équivalent parmi les formats acceptés par cette plateforme`;
  }
  if (!allowed.includes(effective)) {
    const labels = allowed.map((value) => imageFormatLabels[value]).join(', ');
    return `Format incompatible avec cette plateforme (acceptés : ${labels})`;
  }
  return null;
}

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hexadécimale attendue (#RRGGBB)');

export const createImageProjectSchema = z
  .object({
    prompt: z.string().trim().min(10, 'Décrivez la composition (10 caractères minimum)').max(2000),
    title: z.string().trim().max(160).optional(),
    format: imageFormatSchema.optional(),
    width: z.coerce.number().int().min(MIN_IMAGE_SIDE).max(MAX_IMAGE_SIDE).optional(),
    height: z.coerce.number().int().min(MIN_IMAGE_SIDE).max(MAX_IMAGE_SIDE).optional(),
    style: imageStyleSchema.optional(),
    brandId: z.string().min(1).optional(),
    platform: socialPlatformSchema.optional(),
    palette: z.array(hexColor).max(8).optional(),
    logoMediaId: z.string().min(1).optional(),
    referenceMediaIds: z.array(z.string().min(1)).max(8).optional(),
    headline: z.string().trim().max(120).optional(),
    subheadline: z.string().trim().max(200).optional(),
    callToAction: z.string().trim().max(40).optional(),
    badge: z.string().trim().max(30).optional(),
    seed: z.coerce.number().int().min(0).max(2_147_483_647).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.format !== 'CUSTOM') return;
    for (const key of ['width', 'height'] as const) {
      if (value[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Format personnalisé : largeur et hauteur sont obligatoires',
        });
      }
    }
  });
export type CreateImageProjectInput = z.infer<typeof createImageProjectSchema>;

export const updateImageProjectSchema = z
  .object({
    title: z.string().trim().max(160).nullable().optional(),
    prompt: z.string().trim().min(10).max(2000).optional(),
    format: imageFormatSchema.optional(),
    width: z.coerce.number().int().min(MIN_IMAGE_SIDE).max(MAX_IMAGE_SIDE).optional(),
    height: z.coerce.number().int().min(MIN_IMAGE_SIDE).max(MAX_IMAGE_SIDE).optional(),
    style: imageStyleSchema.optional(),
    platform: socialPlatformSchema.nullable().optional(),
    palette: z.array(hexColor).max(8).optional(),
    logoMediaId: z.string().min(1).nullable().optional(),
    referenceMediaIds: z.array(z.string().min(1)).max(8).optional(),
    headline: z.string().trim().max(120).nullable().optional(),
    subheadline: z.string().trim().max(200).nullable().optional(),
    callToAction: z.string().trim().max(40).nullable().optional(),
    badge: z.string().trim().max(30).nullable().optional(),
    seed: z.coerce.number().int().min(0).max(2_147_483_647).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Aucune modification fournie' });
export type UpdateImageProjectInput = z.infer<typeof updateImageProjectSchema>;

export const imageProjectSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  brandId: z.string().nullable(),
  title: z.string().nullable(),
  prompt: z.string(),
  format: imageFormatSchema,
  width: z.number(),
  height: z.number(),
  style: imageStyleSchema,
  provider: z.string(),
  model: z.string(),
  seed: z.number(),
  platform: socialPlatformSchema.nullable(),
  palette: z.array(z.string()),
  logoMediaId: z.string().nullable(),
  referenceMediaIds: z.array(z.string()),
  headline: z.string().nullable(),
  subheadline: z.string().nullable(),
  callToAction: z.string().nullable(),
  badge: z.string().nullable(),
  warnings: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ImageProject = z.infer<typeof imageProjectSchema>;

export const imageProjectDetailSchema = imageProjectSchema.extend({
  /** Source SVG complète, reproductible et modifiable. */
  svg: z.string(),
});
export type ImageProjectDetail = z.infer<typeof imageProjectDetailSchema>;
