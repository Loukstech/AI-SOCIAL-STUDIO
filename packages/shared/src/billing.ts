import { z } from 'zod';

/** Registre de crédits et quotas (§16.2), sans passerelle de paiement. */

export const planSchema = z.object({
  key: z.string(),
  name: z.string(),
  monthlyCredits: z.number().int().nullable(),
  active: z.boolean(),
});
export type Plan = z.infer<typeof planSchema>;

export const creditTransactionTypes = ['GRANT', 'RESERVE', 'CONFIRM', 'REFUND', 'ADJUST'] as const;
export const creditTransactionTypeSchema = z.enum(creditTransactionTypes);
export type CreditTransactionType = (typeof creditTransactionTypes)[number];

export const creditAccountSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  planKey: z.string(),
  planName: z.string(),
  /** Crédits disponibles, réservations exclues. */
  balance: z.number().int(),
  /** Crédits momentanément réservés par une opération en cours. */
  reserved: z.number().int(),
  /** Quota mensuel du plan ; `null` si le plan ne plafonne pas. */
  monthlyLimit: z.number().int().nullable(),
  updatedAt: z.string(),
});
export type CreditAccount = z.infer<typeof creditAccountSchema>;

export const creditTransactionSchema = z.object({
  id: z.string(),
  type: creditTransactionTypeSchema,
  amount: z.number().int(),
  idempotencyKey: z.string(),
  label: z.string().nullable(),
  createdAt: z.string(),
});
export type CreditTransaction = z.infer<typeof creditTransactionSchema>;

export const creditLedgerSchema = z.object({
  account: creditAccountSchema,
  transactions: z.array(creditTransactionSchema),
});
export type CreditLedger = z.infer<typeof creditLedgerSchema>;

/** Réserver avant traitement, confirmer au succès, rembourser à l'échec. */
export const reserveCreditsSchema = z.object({
  amount: z.number().int().positive('Le montant doit être positif').max(1_000_000),
  idempotencyKey: z.string().trim().min(3).max(120),
  label: z.string().trim().min(1).max(160).optional(),
});
export type ReserveCreditsInput = z.infer<typeof reserveCreditsSchema>;

/**
 * Octroi manuel (§16.2 + §17). Sans `organizationId`, le super-admin crédite
 * sa propre organisation ; avec ce champ, il cible explicitement un client.
 * La route reste réservée aux administrateurs plateforme.
 */
export const grantCreditsSchema = reserveCreditsSchema.extend({
  organizationId: z.string().trim().min(1).optional(),
});
export type GrantCreditsInput = z.infer<typeof grantCreditsSchema>;

export const settleCreditsSchema = z.object({
  idempotencyKey: z.string().trim().min(3).max(120),
});
export type SettleCreditsInput = z.infer<typeof settleCreditsSchema>;

export const creditOperationSchema = z.object({
  account: creditAccountSchema,
  transaction: creditTransactionSchema,
  /** `true` si la clé d'idempotence avait déjà été traitée. */
  replayed: z.boolean(),
});
export type CreditOperation = z.infer<typeof creditOperationSchema>;

/** Motif lisible quand une réservation est refusée, jamais un débit silencieux. */
export const creditRefusalReasons = [
  'PLAN_UNKNOWN',
  'INSUFFICIENT_CREDITS',
  'MONTHLY_LIMIT_REACHED',
] as const;
export const creditRefusalReasonSchema = z.enum(creditRefusalReasons);
export type CreditRefusalReason = (typeof creditRefusalReasons)[number];
