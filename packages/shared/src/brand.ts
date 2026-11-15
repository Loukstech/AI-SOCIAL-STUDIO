import { z } from 'zod';
import { socialPlatformSchema } from './social.js';

/**
 * Brand Kit (§8).
 *
 * Une organisation gère plusieurs marques. Chaque marque porte son identité
 * complète : logos **référencés** (jamais copiés), palette, polices, slogan,
 * coordonnées, liens sociaux, images de référence et consignes éditoriales.
 *
 * Les schémas vivent dans leur propre fichier pour éviter le cycle
 * d'imports `saas.ts ↔ social.ts` : `social.ts` a besoin de
 * `organizationRoleSchema`, et le Brand Kit a besoin des plateformes.
 */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hexadécimale attendue (#RRGGBB)');

export const brandSocialLinkSchema = z.object({
  platform: socialPlatformSchema,
  url: z.string().trim().url('URL attendue').max(2048),
});
export type BrandSocialLink = z.infer<typeof brandSocialLinkSchema>;

export const createBrandSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  primaryColor: hexColor.optional(),
  toneOfVoice: z.string().trim().max(300).optional(),
  /** Palette ordonnée du fond vers l'accent ; la première couleur sert de fond. */
  palette: z.array(hexColor).max(8, '8 couleurs au maximum').optional(),
  logoPrimaryId: z.string().min(1).optional(),
  logoSecondaryId: z.string().min(1).optional(),
  headingFont: z.string().trim().max(80).optional(),
  bodyFont: z.string().trim().max(80).optional(),
  slogan: z.string().trim().max(160).optional(),
  website: z.string().trim().url('URL attendue').max(2048).optional(),
  contactEmail: z.string().trim().toLowerCase().email().max(254).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  socialLinks: z.array(brandSocialLinkSchema).max(8).optional(),
  referenceImageIds: z.array(z.string().min(1)).max(12).optional(),
  editorialInstructions: z.string().trim().max(2000).optional(),
});
export type CreateBrandInput = z.infer<typeof createBrandSchema>;

export const updateBrandSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    primaryColor: hexColor.nullable().optional(),
    toneOfVoice: z.string().trim().max(300).nullable().optional(),
    palette: z.array(hexColor).max(8).optional(),
    logoPrimaryId: z.string().min(1).nullable().optional(),
    logoSecondaryId: z.string().min(1).nullable().optional(),
    headingFont: z.string().trim().max(80).nullable().optional(),
    bodyFont: z.string().trim().max(80).nullable().optional(),
    slogan: z.string().trim().max(160).nullable().optional(),
    website: z.string().trim().url('URL attendue').max(2048).nullable().optional(),
    contactEmail: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
    contactPhone: z.string().trim().max(40).nullable().optional(),
    socialLinks: z.array(brandSocialLinkSchema).max(8).optional(),
    referenceImageIds: z.array(z.string().min(1)).max(12).optional(),
    editorialInstructions: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Aucune modification fournie' });
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;

/** Vue complète d'une marque : tous les champs du kit, `null` quand vides. */
export const brandSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  primaryColor: z.string().nullable(),
  toneOfVoice: z.string().nullable(),
  palette: z.array(z.string()),
  logoPrimaryId: z.string().nullable(),
  logoSecondaryId: z.string().nullable(),
  headingFont: z.string().nullable(),
  bodyFont: z.string().nullable(),
  slogan: z.string().nullable(),
  website: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  socialLinks: z.array(brandSocialLinkSchema),
  referenceImageIds: z.array(z.string()),
  editorialInstructions: z.string().nullable(),
  createdAt: z.string(),
});
export type Brand = z.infer<typeof brandSchema>;

/** Palette effective : `palette` si renseignée, sinon `primaryColor`, sinon vide. */
export function brandPalette(brand: Pick<Brand, 'palette' | 'primaryColor'>): string[] {
  if (brand.palette.length > 0) return brand.palette;
  return brand.primaryColor ? [brand.primaryColor] : [];
}
