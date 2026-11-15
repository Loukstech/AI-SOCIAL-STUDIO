import { z } from 'zod';
import { organizationRoleSchema } from './saas.js';

/** Contrats partagés de la Phase 2 : comptes sociaux et invitations. */

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Date ISO attendue');

export const socialPlatforms = [
  'INSTAGRAM',
  'FACEBOOK',
  'TIKTOK',
  'LINKEDIN',
  'YOUTUBE',
  'X',
  'PINTEREST',
  'THREADS',
] as const;

export const socialPlatformSchema = z.enum(socialPlatforms);
export type SocialPlatform = (typeof socialPlatforms)[number];

export const socialPlatformLabels: Record<SocialPlatform, string> = {
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  TIKTOK: 'TikTok',
  LINKEDIN: 'LinkedIn',
  YOUTUBE: 'YouTube',
  X: 'X (Twitter)',
  PINTEREST: 'Pinterest',
  THREADS: 'Threads',
};

export const socialAccountStatuses = ['CONNECTED', 'EXPIRED', 'REVOKED', 'ERROR'] as const;
export const socialAccountStatusSchema = z.enum(socialAccountStatuses);
export type SocialAccountStatus = (typeof socialAccountStatuses)[number];

export const createSocialAccountSchema = z.object({
  platform: socialPlatformSchema,
  username: z.string().trim().min(1, 'Nom d’utilisateur requis').max(120),
  displayName: z.string().trim().max(120).optional(),
  brandId: z.string().min(1).optional(),
  /** Jeton fourni manuellement ; chiffré avant stockage, jamais renvoyé par l'API. */
  accessToken: z.string().trim().min(8).max(4096).optional(),
  refreshToken: z.string().trim().min(8).max(4096).optional(),
  tokenExpiresAt: isoDate.optional(),
  scopes: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
});
export type CreateSocialAccountInput = z.infer<typeof createSocialAccountSchema>;

export const updateSocialAccountSchema = z
  .object({
    displayName: z.string().trim().max(120).nullable().optional(),
    status: socialAccountStatusSchema.optional(),
    brandId: z.string().min(1).nullable().optional(),
    accessToken: z.string().trim().min(8).max(4096).optional(),
    refreshToken: z.string().trim().min(8).max(4096).optional(),
    tokenExpiresAt: isoDate.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Aucune modification fournie' });
export type UpdateSocialAccountInput = z.infer<typeof updateSocialAccountSchema>;

/** Vue publique d'un compte social : aucun jeton, seulement leur présence. */
export const socialAccountSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  brandId: z.string().nullable(),
  platform: socialPlatformSchema,
  username: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  status: socialAccountStatusSchema,
  scopes: z.array(z.string()),
  tokenExpiresAt: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  hasAccessToken: z.boolean(),
  hasRefreshToken: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SocialAccount = z.infer<typeof socialAccountSchema>;

// --- Invitations ---

export const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: organizationRoleSchema.default('EDITOR'),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const invitationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  email: z.string(),
  role: organizationRoleSchema,
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  isPending: z.boolean(),
});
export type Invitation = z.infer<typeof invitationSchema>;

/**
 * Réponse à la création d'une invitation. `acceptUrl` et `token` ne sont
 * renvoyés qu'à l'administrateur qui invite, pour transmettre le lien
 * (l'envoi d'e-mail automatique arrive avec le fournisseur transactionnel).
 */
export const createdInvitationSchema = invitationSchema.extend({
  acceptUrl: z.string(),
  token: z.string(),
});
export type CreatedInvitation = z.infer<typeof createdInvitationSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().trim().min(16).max(512),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const acceptedInvitationSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  role: organizationRoleSchema,
});
export type AcceptedInvitation = z.infer<typeof acceptedInvitationSchema>;
