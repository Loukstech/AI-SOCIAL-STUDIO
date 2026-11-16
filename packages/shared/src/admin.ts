import { z } from 'zod';

/** Contrats de l'administration plateforme (§17). */

export const adminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  createdAt: z.string(),
  isSuperAdmin: z.boolean(),
  disabled: z.boolean(),
  organizations: z.number().int(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  planKey: z.string(),
  members: z.number().int(),
  createdAt: z.string(),
});
export type AdminOrganization = z.infer<typeof adminOrganizationSchema>;

export const adminAuditEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  actorEmail: z.string().nullable(),
  organizationName: z.string().nullable(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminAuditEntry = z.infer<typeof adminAuditEntrySchema>;

export const adminOverviewSchema = z.object({
  users: z.number().int(),
  organizations: z.number().int(),
  disabledUsers: z.number().int(),
  superAdmins: z.number().int(),
  plans: z.number().int(),
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

/**
 * Une opération administrative ne touche qu'aux champs explicitement fournis.
 * `disabled` passe par `deletedAt` : aucun compte n'est supprimé physiquement.
 */
export const updateAdminUserSchema = z
  .object({
    isSuperAdmin: z.boolean().optional(),
    disabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Au moins un champ est requis');
export type UpdateAdminUserInput = z.infer<typeof updateAdminUserSchema>;

export const updateOrganizationPlanSchema = z.object({
  planKey: z.string().trim().min(1).max(40),
});
export type UpdateOrganizationPlanInput = z.infer<typeof updateOrganizationPlanSchema>;

export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;
