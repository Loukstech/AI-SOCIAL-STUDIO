import { useCallback, useState } from 'react';
import {
  commentVisibilityLabels,
  groupThreads,
  isOverdue,
  taskStatusLabels,
  type Comment,
  type CommentVisibility,
  type HistoryEntry,
  type OrganizationRole,
  type Task,
  type TaskStatus,
} from '@ass/shared';
import { api } from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';
import { Alert, Button, Card, Empty, formatDate } from './ui';

/**
 * Les trois volets du §14 dans la fiche d'un contenu : le fil de discussion,
 * les tâches et la chronologie.
 *
 * Deux principes d'interface :
 *
 * 1. **On n'affiche pas un formulaire qui sera refusé.** Les droits viennent du
 *    rôle réel dans l'organisation active, passé en propriété ; l'API reste
 *    seule juge, mais l'écran ne propose pas une action vouée au 403.
 * 2. **Un échec est dit.** Chaque panneau affiche l'erreur renvoyée par l'API
 *    au lieu de laisser croire que l'action a réussi.
 */

const TONE: Record<HistoryEntry['kind'], string> = {
  STATUS: 'border-accent/40 text-accent',
  AUDIT: 'border-border text-text-muted',
  COMMENT: 'border-border text-text',
  TASK: 'border-border text-text-muted',
};

const KIND_LABELS: Record<HistoryEntry['kind'], string> = {
  STATUS: 'Statut',
  AUDIT: 'Action',
  COMMENT: 'Commentaire',
  TASK: 'Tâche',
};

// --- Fil de commentaires ---

export function CommentThread({
  publicationId,
  role,
  userId,
}: {
  publicationId: string;
  role: OrganizationRole;
  userId: string;
}) {
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<CommentVisibility>(
    role === 'CLIENT' ? 'CLIENT' : 'INTERNAL',
  );
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  const canWrite = role !== 'VIEWER';
  const canResolve = role === 'OWNER' || role === 'ADMIN' || role === 'EDITOR';

  const fetchComments = useCallback(
    () => api.collaboration.comments(publicationId),
    [publicationId],
  );
  const { data, error: loadError, reload } = useAsyncData(fetchComments);

  const comments = data?.comments ?? [];
  const open = data?.open ?? 0;
  const error = loadError || actionError;

  async function submit() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      await api.collaboration.addComment(publicationId, {
        body: text,
        visibility,
        ...(replyTo ? { parentId: replyTo } : {}),
      });
      setBody('');
      setReplyTo(null);
      setActionError('');
      reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Envoi impossible');
    } finally {
      setBusy(false);
    }
  }

  async function toggleResolved(comment: Comment) {
    setBusy(true);
    try {
      await api.collaboration.updateComment(comment.id, { resolved: comment.resolvedAt === null });
      setActionError('');
      reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Mise à jour impossible');
    } finally {
      setBusy(false);
    }
  }

  const threads = groupThreads(comments);

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Discussion</h2>
        <span className="text-xs text-text-muted">
          {open === 0
            ? 'Aucun point ouvert'
            : `${open} point${open > 1 ? 's' : ''} ouvert${open > 1 ? 's' : ''}`}
        </span>
      </div>

      {error && <Alert>{error}</Alert>}

      {threads.length === 0 ? (
        <Empty>Aucun commentaire pour l’instant.</Empty>
      ) : (
        <ul className="space-y-3">
          {threads.map(({ root, replies }) => (
            <li key={root.id} className="space-y-2">
              <CommentBubble
                comment={root}
                canResolve={canResolve || root.authorId === userId}
                busy={busy}
                onReply={canWrite ? () => setReplyTo(root.id) : undefined}
                onToggle={() => void toggleResolved(root)}
              />
              {replies.length > 0 && (
                <ul className="ml-4 space-y-2 border-l border-border pl-3">
                  {replies.map((reply) => (
                    <li key={reply.id}>
                      <CommentBubble
                        comment={reply}
                        canResolve={canResolve || reply.authorId === userId}
                        busy={busy}
                        onToggle={() => void toggleResolved(reply)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <div className="space-y-2 border-t border-border pt-3">
          {replyTo && (
            <p className="text-xs text-text-muted">
              Réponse à un commentaire —{' '}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-accent"
                onClick={() => setReplyTo(null)}
              >
                annuler
              </button>
            </p>
          )}
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Écrire un commentaire…"
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {role === 'CLIENT' ? (
              <span className="text-xs text-text-muted">
                Votre commentaire est visible de l’agence.
              </span>
            ) : (
              <label className="flex items-center gap-2 text-xs text-text-muted">
                <span>Portée</span>
                <select
                  value={visibility}
                  onChange={(event) => setVisibility(event.target.value as CommentVisibility)}
                  className="rounded-lg border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
                >
                  {(['INTERNAL', 'CLIENT'] as CommentVisibility[]).map((option) => (
                    <option key={option} value={option}>
                      {commentVisibilityLabels[option]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button disabled={busy || body.trim().length === 0} onClick={() => void submit()}>
              {replyTo ? 'Répondre' : 'Commenter'}
            </Button>
          </div>
        </div>
      ) : (
        <p className="border-t border-border pt-3 text-xs text-text-muted">
          Votre rôle donne un accès en lecture : la discussion est consultable, pas modifiable.
        </p>
      )}
    </Card>
  );
}

function CommentBubble({
  comment,
  canResolve,
  busy,
  onReply,
  onToggle,
}: {
  comment: Comment;
  canResolve: boolean;
  busy: boolean;
  onReply?: () => void;
  onToggle: () => void;
}) {
  const resolved = comment.resolvedAt !== null;
  return (
    <div
      className={`rounded-lg border p-3 ${resolved ? 'border-border bg-bg/40 opacity-70' : 'border-border'}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
        <span className="font-medium text-text">{comment.authorName}</span>
        <span>{formatDate(comment.createdAt)}</span>
        {comment.visibility === 'INTERNAL' && (
          <span className="rounded border border-border px-1.5 py-0.5">Interne</span>
        )}
        {resolved && (
          <span className="rounded border border-border px-1.5 py-0.5">
            Résolu{comment.resolvedByName ? ` par ${comment.resolvedByName}` : ''}
          </span>
        )}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm">{comment.body}</p>
      <div className="mt-2 flex gap-3 text-xs">
        {onReply && (
          <button
            type="button"
            onClick={onReply}
            className="text-text-muted underline-offset-2 hover:text-accent hover:underline"
          >
            Répondre
          </button>
        )}
        {canResolve && (
          <button
            type="button"
            disabled={busy}
            onClick={onToggle}
            className="text-text-muted underline-offset-2 hover:text-accent hover:underline disabled:opacity-50"
          >
            {resolved ? 'Rouvrir' : 'Marquer résolu'}
          </button>
        )}
      </div>
    </div>
  );
}

// --- Tâches ---

export function PublicationTasks({
  publicationId,
  role,
}: {
  publicationId: string;
  role: OrganizationRole;
}) {
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  const canManage = role === 'OWNER' || role === 'ADMIN' || role === 'EDITOR';

  const fetchTasks = useCallback(
    () => api.collaboration.tasks({ entityType: 'publication', entityId: publicationId }),
    [publicationId],
  );
  const { data, error: loadError, reload } = useAsyncData(fetchTasks);
  const tasks = data ?? [];
  const error = loadError || actionError;

  async function create() {
    if (title.trim().length < 2) return;
    setBusy(true);
    try {
      await api.collaboration.createTask({
        title: title.trim(),
        entityType: 'publication',
        entityId: publicationId,
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
      });
      setTitle('');
      setDueAt('');
      setActionError('');
      reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Création impossible');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(task: Task, status: TaskStatus) {
    setBusy(true);
    try {
      await api.collaboration.updateTask(task.id, { status });
      setActionError('');
      reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Mise à jour impossible');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">Tâches liées</h2>
      {error && <Alert>{error}</Alert>}

      {tasks.length === 0 ? (
        <Empty>Aucune tâche assignée à ce contenu.</Empty>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => {
            const late = isOverdue({ status: task.status, dueAt: task.dueAt });
            return (
              <li
                key={task.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm">{task.title}</p>
                  <p className="text-xs text-text-muted">
                    {taskStatusLabels[task.status]}
                    {task.assigneeName ? ` · ${task.assigneeName}` : ' · non assignée'}
                    {task.dueAt ? ` · échéance ${formatDate(task.dueAt)}` : ''}
                    {late ? ' · en retard' : ''}
                  </p>
                </div>
                {canManage && task.status === 'OPEN' && (
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void setStatus(task, 'DONE')}
                    >
                      Terminer
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void setStatus(task, 'CANCELLED')}
                    >
                      Annuler
                    </Button>
                  </div>
                )}
                {canManage && task.status !== 'OPEN' && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void setStatus(task, 'OPEN')}
                  >
                    Rouvrir
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="block min-w-48 flex-1 space-y-1.5">
            <span className="block text-xs text-text-muted">Nouvelle tâche</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Relire la copie, préparer les visuels…"
              className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-xs text-text-muted">Échéance</span>
            <input
              type="date"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              className="rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
          </label>
          <Button disabled={busy || title.trim().length < 2} onClick={() => void create()}>
            Ajouter
          </Button>
        </div>
      ) : (
        <p className="border-t border-border pt-3 text-xs text-text-muted">
          Les tâches sont gérées par l’agence ; vous les consultez en lecture.
        </p>
      )}
    </Card>
  );
}

// --- Historique ---

export function PublicationHistory({ publicationId }: { publicationId: string }) {
  const fetchHistory = useCallback(() => api.collaboration.history(publicationId), [publicationId]);
  const { data, error } = useAsyncData(fetchHistory);
  const entries = data?.entries ?? [];
  const truncated = data?.truncated ?? 0;

  return (
    <Card className="space-y-2">
      <h2 className="text-sm font-semibold">Historique</h2>
      {error && <Alert>{error}</Alert>}
      {entries.length === 0 ? (
        <Empty>Aucun événement enregistré.</Empty>
      ) : (
        <ol className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="flex gap-2 text-xs">
              <span className="w-32 shrink-0 tabular-nums text-text-muted">
                {formatDate(entry.at)}
              </span>
              <span
                className={`shrink-0 self-start rounded border px-1.5 py-0.5 ${TONE[entry.kind]}`}
              >
                {KIND_LABELS[entry.kind]}
              </span>
              <span className="min-w-0">
                <span className="text-text">{entry.label}</span>
                {entry.detail && <span className="block text-text-muted">{entry.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {truncated > 0 && (
        <p className="text-xs text-text-muted">
          {truncated} événement{truncated > 1 ? 's' : ''} plus ancien{truncated > 1 ? 's' : ''} non
          affiché{truncated > 1 ? 's' : ''}.
        </p>
      )}
    </Card>
  );
}
