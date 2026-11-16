import { z } from 'zod';
import { organizationRoleSchema, type OrganizationRole } from './saas.js';

/**
 * Collaboration (§14).
 *
 * Le §14 décrit un espace client : commentaires, assignation de tâches,
 * historique des modifications, validation par le client. Quatre choses, et une
 * contrainte qui les traverse toutes :
 *
 * > « Un client doit pouvoir approuver ou refuser les contenus qui le concernent
 * > sans accéder aux autres clients ni aux paramètres internes de l'agence. »
 *
 * Cette contrainte n'est pas un rôle de plus, c'est une **règle de visibilité**.
 * Un commentaire interne reste interne, y compris pour un client qui a le droit
 * de commenter : le filtre s'applique côté API, pas côté écran.
 */

// --- Visibilité ---

export const commentVisibilitySchema = z.enum(['INTERNAL', 'CLIENT']);
export type CommentVisibility = z.infer<typeof commentVisibilitySchema>;

export const commentVisibilityLabels: Record<CommentVisibility, string> = {
  INTERNAL: 'Interne à l’agence',
  CLIENT: 'Visible par le client',
};

/**
 * Le rôle `CLIENT` ne voit que ce qui est marqué `CLIENT`.
 *
 * Les autres rôles voient tout : un éditeur doit pouvoir lire les échanges
 * internes d'un même contenu.
 */
export function canSeeComment(role: OrganizationRole, visibility: CommentVisibility): boolean {
  return role === 'CLIENT' ? visibility === 'CLIENT' : true;
}

/** Filtre une liste de commentaires selon le rôle de celui qui regarde. */
export function filterVisible<T extends { visibility: CommentVisibility }>(
  role: OrganizationRole,
  comments: T[],
): T[] {
  return comments.filter((comment) => canSeeComment(role, comment.visibility));
}

// --- Commentaires ---

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Date ISO attendue');

export const commentSchema = z.object({
  id: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  body: z.string(),
  visibility: commentVisibilitySchema,
  /** `null` pour un commentaire racine, sinon l'identifiant du fil. */
  parentId: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolvedByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Comment = z.infer<typeof commentSchema>;

/**
 * Commentaires d'un contenu, à plat et dans l'ordre chronologique.
 *
 * Les réponses ne s'imbriquent que sur **un niveau** : une réponse répond à un
 * commentaire racine, jamais à une autre réponse. Cela évite les fils
 * indénichables, et l'interface regroupe simplement par `parentId`.
 */
export const commentListSchema = z.object({
  comments: z.array(commentSchema),
  /** Total avant filtrage de visibilité — jamais exposé tel quel au client. */
  total: z.number(),
  open: z.number(),
});
export type CommentList = z.infer<typeof commentListSchema>;

export const createCommentSchema = z.object({
  body: z.string().trim().min(1, 'Le commentaire ne peut pas être vide').max(2_000),
  visibility: commentVisibilitySchema.default('INTERNAL'),
  parentId: z.string().min(1).optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = z
  .object({
    body: z.string().trim().min(1).max(2_000).optional(),
    /** Marquer comme résolu (ou rouvrir avec `false`). */
    resolved: z.boolean().optional(),
  })
  .refine(
    (value) => value.body !== undefined || value.resolved !== undefined,
    'Aucune modification demandée',
  );
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;

/** Nombre de commentaires non résolus. */
export function countOpen(comments: { resolvedAt: string | null }[]): number {
  return comments.filter((comment) => comment.resolvedAt === null).length;
}

/**
 * Regroupe les commentaires en fils : racines chronologiques, réponses
 * rattachées à leur parent.
 *
 * Une réponse orpheline (parent masqué par la visibilité) est traitée comme une
 * racine plutôt que d'être perdue : un client qui répond à un commentaire
 * interne ne verra pas sa réponse disparaître.
 */
export function groupThreads(comments: Comment[]): { root: Comment; replies: Comment[] }[] {
  const ids = new Set(comments.map((comment) => comment.id));
  const roots = comments.filter(
    (comment) => comment.parentId === null || !ids.has(comment.parentId),
  );
  return roots.map((root) => ({
    root,
    replies: comments.filter((comment) => comment.parentId === root.id),
  }));
}

// --- Tâches ---

export const taskStatusSchema = z.enum(['OPEN', 'DONE', 'CANCELLED']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskStatusLabels: Record<TaskStatus, string> = {
  OPEN: 'À faire',
  DONE: 'Terminée',
  CANCELLED: 'Annulée',
};

export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatusSchema,
  assigneeId: z.string().nullable(),
  assigneeName: z.string().nullable(),
  createdById: z.string().nullable(),
  createdByName: z.string().nullable(),
  dueAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof taskSchema>;

export const createTaskSchema = z.object({
  title: z.string().trim().min(2, 'Au moins 2 caractères').max(160),
  description: z.string().trim().max(2_000).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  dueAt: isoDate.nullable().optional(),
  entityType: z.string().min(1).max(40).optional(),
  entityId: z.string().min(1).optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(2).max(160).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    assigneeId: z.string().min(1).nullable().optional(),
    dueAt: isoDate.nullable().optional(),
    status: taskStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Aucune modification demandée');
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const taskQuerySchema = z.object({
  entityType: z.string().min(1).max(40).optional(),
  entityId: z.string().min(1).optional(),
  assigneeId: z.string().min(1).optional(),
  status: taskStatusSchema.optional(),
});
export type TaskQuery = z.infer<typeof taskQuerySchema>;

/**
 * Une tâche est en retard quand elle est ouverte et que son échéance est
 * passée. Une tâche terminée ne l'est jamais, même si elle a été close après
 * l'échéance : le retard se constate, il ne se réécrit pas.
 */
export function isOverdue(
  task: { status: TaskStatus; dueAt: string | null },
  now = new Date(),
): boolean {
  if (task.status !== 'OPEN' || !task.dueAt) return false;
  return new Date(task.dueAt).getTime() < now.getTime();
}

/** Tri d'affichage : en retard d'abord, puis échéance la plus proche, puis création. */
export function sortTasks(tasks: Task[], now = new Date()): Task[] {
  return [...tasks].sort((a, b) => {
    const overdueA = isOverdue(a, now) ? 0 : 1;
    const overdueB = isOverdue(b, now) ? 0 : 1;
    if (overdueA !== overdueB) return overdueA - overdueB;
    const dueA = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const dueB = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (dueA !== dueB) return dueA - dueB;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

// --- Historique ---

export const historyKindSchema = z.enum(['STATUS', 'AUDIT', 'COMMENT', 'TASK']);
export type HistoryKind = z.infer<typeof historyKindSchema>;

export const historyEntrySchema = z.object({
  id: z.string(),
  kind: historyKindSchema,
  at: z.string(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  /** Phrase lisible, déjà rédigée côté serveur. */
  label: z.string(),
  /** Complément facultatif : motif de refus, ancienne valeur, etc. */
  detail: z.string().nullable(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const historySchema = z.object({
  entries: z.array(historyEntrySchema),
  /** Nombre d'entrées antérieures non renvoyées (fenêtre d'affichage). */
  truncated: z.number(),
});
export type History = z.infer<typeof historySchema>;

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(80),
});
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

// --- Tableau de bord par client ---

export const clientSummarySchema = z.object({
  organizationId: z.string(),
  name: z.string(),
  slug: z.string(),
  role: organizationRoleSchema,
  publications: z.number(),
  pendingApprovals: z.number(),
  openTasks: z.number(),
  overdueTasks: z.number(),
  openComments: z.number(),
  lastActivityAt: z.string().nullable(),
});
export type ClientSummary = z.infer<typeof clientSummarySchema>;

export const portfolioSchema = z.object({
  clients: z.array(clientSummarySchema),
  totals: z.object({
    clients: z.number(),
    publications: z.number(),
    pendingApprovals: z.number(),
    openTasks: z.number(),
    overdueTasks: z.number(),
  }),
});
export type Portfolio = z.infer<typeof portfolioSchema>;
