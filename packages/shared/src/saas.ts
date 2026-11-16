import { z } from 'zod';

/** Contrats partagés API / frontend de la Phase 1 (Fondations SaaS). */

/**
 * Rôles d'une organisation.
 *
 * `CLIENT` est le rôle d'un client final (§14) : il lit tout son espace,
 * commente et valide les contenus qui le concernent, mais ne modifie rien et
 * n'accède à aucun réglage.
 */
export const organizationRoles = ['OWNER', 'ADMIN', 'EDITOR', 'CLIENT', 'VIEWER'] as const;
export const organizationRoleSchema = z.enum(organizationRoles);
export type OrganizationRole = (typeof organizationRoles)[number];

export const organizationRoleLabels: Record<OrganizationRole, string> = {
  OWNER: 'Propriétaire',
  ADMIN: 'Administrateur',
  EDITOR: 'Éditeur',
  CLIENT: 'Client',
  VIEWER: 'Lecteur',
};

/** Rôles autorisés à valider ou refuser un contenu (§14, validation client). */
export const reviewerRoles: OrganizationRole[] = ['OWNER', 'ADMIN', 'CLIENT'];

export const mediaKinds = ['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'] as const;
export const mediaKindSchema = z.enum(mediaKinds);
export type MediaKind = (typeof mediaKinds)[number];

/**
 * Hiérarchie des droits : un rang plus petit est plus puissant.
 *
 * `CLIENT` s'insère entre `EDITOR` et `VIEWER` : il peut tout ce qu'un lecteur
 * peut faire, plus commenter et valider — mais rien de ce qu'un éditeur peut
 * faire. La validation, elle, ne se déduit pas du rang (un éditeur ne valide
 * pas son propre contenu) : elle passe par `reviewerRoles`.
 */
export const roleRank: Record<OrganizationRole, number> = {
  OWNER: 0,
  ADMIN: 1,
  EDITOR: 2,
  CLIENT: 3,
  VIEWER: 4,
};

export function hasAtLeast(actual: OrganizationRole, required: OrganizationRole): boolean {
  return roleRank[actual] <= roleRank[required];
}

// --- Authentification ---

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, 'Au moins 8 caractères').max(128),
  name: z.string().trim().min(2, 'Au moins 2 caractères').max(120),
  organizationName: z.string().trim().min(2).max(120).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  createdAt: z.string(),
});
export type User = z.infer<typeof userSchema>;

export const authResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  user: userSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

// --- Organisations et membres ---

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  /** Fuseau de référence pour l'affichage et la programmation (§11). */
  timezone: z.string(),
  role: organizationRoleSchema,
  createdAt: z.string(),
});
export type Organization = z.infer<typeof organizationSchema>;

export const memberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  role: organizationRoleSchema,
  createdAt: z.string(),
});
export type Member = z.infer<typeof memberSchema>;

export const addMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: organizationRoleSchema.default('VIEWER'),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

// Les schémas de marque et de Brand Kit vivent dans `brand.ts` (voir §8).

// --- Médiathèque (métadonnées ; le fichier binaire arrive avec le stockage objet) ---

export const createMediaSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: mediaKindSchema.default('IMAGE'),
  mimeType: z.string().trim().max(120).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  sourceUrl: z.string().trim().url().max(2048).optional(),
  brandId: z.string().optional(),
});
export type CreateMediaInput = z.infer<typeof createMediaSchema>;

export const mediaAssetSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  brandId: z.string().nullable(),
  name: z.string(),
  kind: mediaKindSchema,
  mimeType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  sourceUrl: z.string().nullable(),
  createdAt: z.string(),
});
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

// --- Tableau de bord ---

export const dashboardStatsSchema = z.object({
  organizations: z.number(),
  brands: z.number(),
  media: z.number(),
  members: z.number(),
  socialAccounts: z.number(),
  pendingInvitations: z.number(),
  videoProjects: z.number(),
  contentProjects: z.number(),
  publications: z.number(),
  scheduledPublications: z.number(),
  imageProjects: z.number(),
  recentActivity: z.array(
    z.object({
      id: z.string(),
      action: z.string(),
      targetType: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type DashboardStats = z.infer<typeof dashboardStatsSchema>;

export const apiErrorSchema = z.object({
  statusCode: z.number(),
  message: z.union([z.string(), z.array(z.string())]),
  error: z.string().optional(),
});
