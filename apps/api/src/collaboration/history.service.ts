import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  publicationStatusLabels,
  taskStatusLabels,
  type History,
  type HistoryEntry,
  type OrganizationRole,
  type PublicationStatus,
  type TaskStatus,
} from '@ass/shared';
import { Db } from '../common/validation.js';

/**
 * Historique d'un contenu (§14 : « historique des modifications »).
 *
 * L'information existe déjà, mais dispersée dans quatre tables :
 * `PublicationEvent` (transitions d'état), `AuditLog` (actions nommées),
 * `Comment` (échanges) et `Task` (travail demandé). Ce service les fusionne en
 * une seule chronologie.
 *
 * Trois décisions valent d'être explicitées :
 *
 * 1. **Le libellé est rédigé ici, pas dans le navigateur.** Un historique est
 *    une lecture d'audit : la phrase doit être vérifiable côté serveur, et
 *    rester identique dans l'export comme dans l'interface.
 * 2. **Une action inconnue n'est jamais masquée.** Si une nouvelle action
 *    apparaît sans libellé, elle s'affiche avec son code brut plutôt que de
 *    disparaître : un trou dans un historique est pire qu'un libellé sec.
 * 3. **La visibilité s'applique aussi ici.** Un client ne doit pas lire dans
 *    l'historique ce qu'il ne peut pas lire dans le fil de commentaires.
 */

/** Libellés des actions journalisées qui concernent un contenu. */
const ACTION_LABELS: Record<string, string> = {
  'publication.created': 'a créé le contenu',
  'publication.updated': 'a modifié le contenu',
  'publication.rescheduled': 'a replanifié la publication',
  'publication.confirmed': 'a confirmé la publication',
  'publication.duplicated': 'a dupliqué le contenu',
  'publication.deleted': 'a supprimé le contenu',
  'analytics.metric_recorded': 'a saisi des mesures',
};

/** Fenêtre par défaut : au-delà, `truncated` dit combien d'entrées précèdent. */
const DEFAULT_LIMIT = 80;

interface EventRow {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: string | null;
  reason: string | null;
  createdAt: Date;
}

interface AuditRow {
  id: string;
  action: string;
  actorId: string | null;
  metadata: unknown;
  createdAt: Date;
}

interface CommentRow {
  id: string;
  authorId: string;
  body: string;
  visibility: string;
  createdAt: Date;
  author: { name: string };
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  assigneeId: string | null;
  createdById: string | null;
  completedAt: Date | null;
  createdAt: Date;
  assignee: { name: string } | null;
  createdBy: { name: string } | null;
}

@Injectable()
export class HistoryService {
  constructor(@Inject(Db) private readonly db: Db) {}

  /**
   * Chronologie d'un contenu, la plus récente d'abord.
   *
   * `truncated` compte les entrées antérieures à la fenêtre : l'interface peut
   * alors dire « N événements plus anciens » au lieu de laisser croire que
   * l'historique commence là.
   */
  async forPublication(
    organizationId: string,
    role: OrganizationRole,
    publicationId: string,
    limit = DEFAULT_LIMIT,
  ): Promise<History> {
    const publication = await this.db.client.publication.findFirst({
      where: { id: publicationId, organizationId },
      select: { id: true },
    });
    // Même règle que partout ailleurs : hors périmètre, la réponse est 404.
    if (!publication) throw new NotFoundException('Contenu introuvable');
    // Les mesures sont journalisées contre la cible (le réseau), pas contre le
    // contenu : sans cette résolution, la saisie des chiffres manquerait à
    // l'historique alors qu'elle en est un événement à part entière.
    const targets = await this.db.client.publicationTarget.findMany({
      where: { publicationId },
      select: { id: true },
    });
    const targetIds = targets.map((target) => target.id);

    const [events, audits, comments, tasks] = await Promise.all([
      this.db.client.publicationEvent.findMany({
        where: { publicationId },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
      }),
      this.db.client.auditLog.findMany({
        where: {
          organizationId,
          OR: [
            { targetType: 'publication', targetId: publicationId },
            { targetType: 'publication_target', targetId: { in: targetIds } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
      }),
      this.db.client.comment.findMany({
        where: {
          organizationId,
          entityType: 'publication',
          entityId: publicationId,
          deletedAt: null,
          ...(role === 'CLIENT' ? { visibility: 'CLIENT' as const } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        include: { author: { select: { name: true } } },
      }),
      this.db.client.task.findMany({
        where: {
          organizationId,
          OR: [
            { entityType: 'publication', entityId: publicationId },
            // Une tâche libre créée pendant la vie du contenu n'apparaît pas
            // ici : seul ce qui vise explicitement ce contenu est daté par lui.
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        include: {
          assignee: { select: { name: true } },
          createdBy: { select: { name: true } },
        },
      }),
    ]);

    const actorNames = await this.resolveActors([
      ...events.map((event) => event.actorId),
      ...audits.map((audit) => audit.actorId),
    ]);

    const entries: HistoryEntry[] = [
      ...events.map((event) => this.eventEntry(event as unknown as EventRow, actorNames)),
      ...audits.map((audit) => this.auditEntry(audit as unknown as AuditRow, actorNames)),
      ...comments.map((comment) => this.commentEntry(comment as unknown as CommentRow)),
      ...tasks.map((task) => this.taskEntry(task as unknown as TaskRow)),
    ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

    const kept = entries.slice(0, limit);
    return { entries: kept, truncated: Math.max(0, entries.length - kept.length) };
  }

  // --- Fabriques d'entrées ---

  private eventEntry(row: EventRow, names: Map<string, string>): HistoryEntry {
    const to = row.toStatus as PublicationStatus;
    const from = row.fromStatus as PublicationStatus | null;
    const label = from
      ? `Statut : ${publicationStatusLabels[from]} → ${publicationStatusLabels[to]}`
      : `Statut initial : ${publicationStatusLabels[to]}`;
    return {
      id: `event:${row.id}`,
      kind: 'STATUS',
      at: row.createdAt.toISOString(),
      actorId: row.actorId,
      actorName: row.actorId ? (names.get(row.actorId) ?? null) : null,
      label,
      // Le motif d'un refus ou d'une annulation est la partie utile du journal.
      detail: row.reason,
    };
  }

  private auditEntry(row: AuditRow, names: Map<string, string>): HistoryEntry {
    const known = ACTION_LABELS[row.action];
    const actorName = row.actorId ? (names.get(row.actorId) ?? null) : null;
    return {
      id: `audit:${row.id}`,
      kind: 'AUDIT',
      at: row.createdAt.toISOString(),
      actorId: row.actorId,
      actorName,
      // Une action sans libellé s'affiche telle quelle : on ne cache pas un
      // événement parce qu'on a oublié de le traduire.
      label: known
        ? actorName
          ? `${actorName} ${known}`
          : `Action système : ${known.replace(/^a /, '')}`
        : `Action « ${row.action} »`,
      detail: auditDetail(row.metadata),
    };
  }

  private commentEntry(row: CommentRow): HistoryEntry {
    return {
      id: `comment:${row.id}`,
      kind: 'COMMENT',
      at: row.createdAt.toISOString(),
      actorId: row.authorId,
      actorName: row.author.name,
      label: `${row.author.name} a commenté`,
      // Tronqué : l'historique résume, il ne remplace pas le fil.
      detail: excerpt(row.body),
    };
  }

  private taskEntry(row: TaskRow): HistoryEntry {
    const status = row.status as TaskStatus;
    const who = row.assignee?.name ?? null;
    const suffix = who ? ` (${who})` : '';
    return {
      id: `task:${row.id}`,
      kind: 'TASK',
      at: (row.completedAt ?? row.createdAt).toISOString(),
      actorId: row.createdById,
      actorName: row.createdBy?.name ?? null,
      label: `Tâche ${taskStatusLabels[status].toLowerCase()} : ${row.title}${suffix}`,
      detail: null,
    };
  }

  /** Résout les noms d'acteurs en une requête, sans jointure par ligne. */
  private async resolveActors(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();
    const users = await this.db.client.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }
}

/** Extrait un complément lisible d'un `metadata` JSON, sans jamais inventer. */
function auditDetail(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const record = metadata as Record<string, unknown>;
  for (const key of ['rejectionReason', 'reason', 'title', 'platform']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return excerpt(value);
  }
  return null;
}

/** Coupe proprement, sur un mot, à 140 caractères. */
function excerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
