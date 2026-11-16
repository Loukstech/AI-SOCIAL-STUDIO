import { useCallback, useEffect, useState } from 'react';
import type {
  Brand,
  OrganizationRole,
  PostType,
  Publication,
  PublicationDetail,
  PublicationExport,
  PublicationMode,
  PublicationStatus,
  PublishingReadiness,
  SocialAccount,
  SocialPlatform,
} from '@ass/shared';
import {
  canTransition,
  platformSpecs,
  postTypeLabels,
  postTypes,
  publicationModeLabels,
  publicationStatusLabels,
  publicationStatuses,
  socialPlatformLabels,
  socialPlatforms,
} from '@ass/shared';
import { api } from '../lib/api';
import { Alert, Button, Card, Empty, PageHeader, formatDate } from '../components/ui';
import {
  CommentThread,
  PublicationHistory,
  PublicationTasks,
} from '../components/CollaborationPanel';

interface TargetDraft {
  body: string;
  title: string;
  hashtags: string;
}

const STATUS_TONE: Record<PublicationStatus, string> = {
  DRAFT: 'border-border text-text-muted',
  READY_FOR_REVIEW: 'border-accent/40 text-accent',
  PENDING_APPROVAL: 'border-accent/40 text-accent',
  APPROVED: 'border-success/40 text-success',
  SCHEDULED: 'border-accent/40 text-accent',
  PUBLISHING: 'border-accent/40 text-accent',
  PUBLISHED: 'border-success/40 text-success',
  REJECTED: 'border-danger/40 text-danger',
  CANCELLED: 'border-border text-text-muted',
  FAILED: 'border-danger/40 text-danger',
  EXPIRED: 'border-danger/40 text-danger',
};

function draftsFrom(detail: PublicationDetail): Record<string, TargetDraft> {
  return Object.fromEntries(
    detail.targets.map((target) => [
      target.id,
      {
        body: target.body,
        title: target.title ?? '',
        hashtags: target.hashtags.join(' '),
      },
    ]),
  );
}

function parseHashtags(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
}

/** Date locale au format attendu par `datetime-local`. */
function toLocalInput(iso: string | null, timezone: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return parts.replace(' ', 'T');
}

function inTimezone(iso: string | null, timezone: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: timezone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

/**
 * Centre de publication (§10) et collaboration (§14).
 *
 * Le rôle et l'identifiant sont reçus de l'application : la fiche d'un contenu
 * adapte ce qu'elle propose au lieu d'exposer des boutons que l'API refusera.
 */
export function PublishingPage({ role, userId }: { role: OrganizationRole; userId: string }) {
  const [items, setItems] = useState<Publication[]>([]);
  const [detail, setDetail] = useState<PublicationDetail | null>(null);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [readiness, setReadiness] = useState<PublishingReadiness | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [statusFilter, setStatusFilter] = useState<PublicationStatus | ''>('');
  const [platformFilter, setPlatformFilter] = useState<SocialPlatform | ''>('');
  const [reload, setReload] = useState(0);

  const [title, setTitle] = useState('');
  const [postType, setPostType] = useState<PostType>('TEXT');
  const [mode, setMode] = useState<PublicationMode>('AUTO');
  const [brandId, setBrandId] = useState('');
  const [body, setBody] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);

  const [drafts, setDrafts] = useState<Record<string, TargetDraft>>({});
  const [scheduleAt, setScheduleAt] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [confirmUrls, setConfirmUrls] = useState<Record<string, string>>({});
  const [exported, setExported] = useState<PublicationExport | null>(null);

  const load = useCallback(() => {
    setReload((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.publishing.list({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(platformFilter ? { platform: platformFilter } : {}),
      }),
      api.socialAccounts.list(),
      api.brands.list(),
      api.publishing.readiness(),
    ])
      .then(([list, accountList, brandList, ready]) => {
        if (!active) return;
        setItems(list.items);
        setAccounts(accountList);
        setBrands(brandList);
        setReadiness(ready);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Chargement impossible');
      });
    return () => {
      active = false;
    };
  }, [statusFilter, platformFilter, reload]);

  const open = useCallback(async (id: string) => {
    setExported(null);
    setConfirmUrls({});
    setRejectReason('');
    const next = await api.publishing.detail(id);
    setDetail(next);
    setDrafts(draftsFrom(next));
    setScheduleAt(toLocalInput(next.scheduledAt, next.timezone));
  }, []);

  async function run(action: () => Promise<PublicationDetail>): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const next = await action();
      setDetail(next);
      setDrafts(draftsFrom(next));
      setScheduleAt(toLocalInput(next.scheduledAt, next.timezone));
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action impossible');
    } finally {
      setBusy(false);
    }
  }

  async function create(): Promise<void> {
    if (selectedAccounts.length === 0) {
      setError('Sélectionnez au moins un compte social');
      return;
    }
    if (!body.trim()) {
      setError('Le texte est requis');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await api.publishing.create({
        ...(title.trim() ? { title: title.trim() } : {}),
        postType,
        mode,
        ...(brandId ? { brandId } : {}),
        targets: selectedAccounts.map((accountId) => ({ socialAccountId: accountId, body })),
      });
      setDetail(created);
      setDrafts(draftsFrom(created));
      setTitle('');
      setBody('');
      setSelectedAccounts([]);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Création impossible');
    } finally {
      setBusy(false);
    }
  }

  async function saveTargets(): Promise<void> {
    if (!detail) return;
    await run(() =>
      api.publishing.update(detail.id, {
        targets: detail.targets.map((target) => {
          const draft = drafts[target.id];
          return {
            socialAccountId: target.socialAccountId,
            body: draft?.body ?? target.body,
            title: draft?.title ? draft.title : null,
            hashtags: draft ? parseHashtags(draft.hashtags) : target.hashtags,
          };
        }),
      }),
    );
  }

  function toggleAccount(id: string): void {
    setSelectedAccounts((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Centre de publication"
        description="Circuit de validation, programmation et historique — sans jamais simuler un envoi."
      />

      {readiness && !readiness.ready && (
        <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">
          {readiness.message}
        </p>
      )}
      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Nouvelle publication</h2>

            <label className="block space-y-1.5">
              <span className="block text-xs text-text-muted">Titre interne</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Annonce formation IA"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1.5">
                <span className="block text-xs text-text-muted">Format</span>
                <select
                  value={postType}
                  onChange={(event) => setPostType(event.target.value as PostType)}
                  className="w-full rounded-lg border border-border bg-bg px-2 py-2 text-sm outline-none focus:border-accent"
                >
                  {postTypes.map((value) => (
                    <option key={value} value={value}>
                      {postTypeLabels[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="block text-xs text-text-muted">Mode</span>
                <select
                  value={mode}
                  onChange={(event) => setMode(event.target.value as PublicationMode)}
                  className="w-full rounded-lg border border-border bg-bg px-2 py-2 text-sm outline-none focus:border-accent"
                >
                  {(['AUTO', 'APPROVAL'] as PublicationMode[]).map((value) => (
                    <option key={value} value={value}>
                      {publicationModeLabels[value]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {brands.length > 0 && (
              <label className="block space-y-1.5">
                <span className="block text-xs text-text-muted">Marque</span>
                <select
                  value={brandId}
                  onChange={(event) => setBrandId(event.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-2 py-2 text-sm outline-none focus:border-accent"
                >
                  <option value="">Aucune</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="space-y-1.5">
              <span className="block text-xs text-text-muted">Comptes ciblés</span>
              {accounts.length === 0 ? (
                <p className="text-xs text-text-muted">
                  Aucun compte connecté : ajoutez-en dans « Comptes sociaux ».
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {accounts.map((account) => {
                    const active = selectedAccounts.includes(account.id);
                    return (
                      <button
                        key={account.id}
                        type="button"
                        onClick={() => toggleAccount(account.id)}
                        className={`rounded-lg border px-2 py-1 text-xs transition-colors ${
                          active
                            ? 'border-accent bg-accent/12 text-accent'
                            : 'border-border text-text-muted hover:text-text'
                        }`}
                      >
                        {socialPlatformLabels[account.platform]} · {account.username}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <label className="block space-y-1.5">
              <span className="block text-xs text-text-muted">Texte</span>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={5}
                placeholder="Le texte appliqué à tous les comptes, ajustable ensuite par réseau."
                className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>

            <Button onClick={() => void create()} disabled={busy}>
              Créer le brouillon
            </Button>
          </Card>

          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Publications</h2>
              <span className="text-xs text-text-muted">{items.length}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as PublicationStatus | '')}
                className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
              >
                <option value="">Tous les statuts</option>
                {publicationStatuses.map((value) => (
                  <option key={value} value={value}>
                    {publicationStatusLabels[value]}
                  </option>
                ))}
              </select>
              <select
                value={platformFilter}
                onChange={(event) => setPlatformFilter(event.target.value as SocialPlatform | '')}
                className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
              >
                <option value="">Tous les réseaux</option>
                {socialPlatforms.map((value) => (
                  <option key={value} value={value}>
                    {socialPlatformLabels[value]}
                  </option>
                ))}
              </select>
            </div>

            {items.length === 0 ? (
              <Empty>Aucune publication pour ces filtres.</Empty>
            ) : (
              <ul className="space-y-1.5">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void open(item.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                        detail?.id === item.id
                          ? 'border-accent bg-accent/10'
                          : 'border-border hover:border-accent/60'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {item.title ?? 'Sans titre'}
                        </span>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${STATUS_TONE[item.status]}`}
                        >
                          {publicationStatusLabels[item.status]}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs text-text-muted">
                        {item.platforms
                          .map((platform) => socialPlatformLabels[platform])
                          .join(' · ')}
                        {item.scheduledAt ? ` — ${formatDate(item.scheduledAt)}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {!detail ? (
            <Card>
              <Empty>Sélectionnez une publication pour voir son détail.</Empty>
            </Card>
          ) : (
            <>
              <Card className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold">{detail.title ?? 'Sans titre'}</h2>
                    <p className="text-xs text-text-muted">
                      {postTypeLabels[detail.postType]} · {publicationModeLabels[detail.mode]} ·{' '}
                      {detail.timezone}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-3 py-1 text-xs ${STATUS_TONE[detail.status]}`}
                  >
                    {publicationStatusLabels[detail.status]}
                  </span>
                </div>

                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-text-muted">Échéance</dt>
                    <dd>{inTimezone(detail.scheduledAt, detail.timezone)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-muted">Publié le</dt>
                    <dd>{inTimezone(detail.publishedAt, detail.timezone)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-muted">Tentatives</dt>
                    <dd>{detail.attempts}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-muted">Cibles</dt>
                    <dd>{detail.targets.length}</dd>
                  </div>
                </dl>

                {detail.rejectionReason && (
                  <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                    Refusé : {detail.rejectionReason}
                  </p>
                )}
                {detail.lastError && detail.status !== 'PUBLISHED' && (
                  <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {detail.lastError}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  {canTransition(detail.status, 'READY_FOR_REVIEW') && (
                    <Button
                      onClick={() => void run(() => api.publishing.submit(detail.id))}
                      disabled={busy}
                    >
                      Soumettre
                    </Button>
                  )}
                  {canTransition(detail.status, 'PENDING_APPROVAL') && (
                    <Button
                      onClick={() => void run(() => api.publishing.requestApproval(detail.id))}
                      disabled={busy}
                    >
                      Demander validation
                    </Button>
                  )}
                  {canTransition(detail.status, 'APPROVED') && (
                    <Button
                      onClick={() => void run(() => api.publishing.approve(detail.id))}
                      disabled={busy}
                    >
                      Valider
                    </Button>
                  )}
                  {canTransition(detail.status, 'PUBLISHING') && (
                    <Button
                      onClick={() => void run(() => api.publishing.publish(detail.id))}
                      disabled={busy}
                    >
                      Publier maintenant
                    </Button>
                  )}
                  {detail.status === 'FAILED' && detail.attempts < 3 && (
                    <Button
                      onClick={() => void run(() => api.publishing.retry(detail.id))}
                      disabled={busy}
                    >
                      Réessayer
                    </Button>
                  )}
                  {canTransition(detail.status, 'CANCELLED') && (
                    <Button
                      variant="ghost"
                      onClick={() => void run(() => api.publishing.cancel(detail.id, {}))}
                      disabled={busy}
                    >
                      Annuler
                    </Button>
                  )}
                  {detail.status !== 'DRAFT' && canTransition(detail.status, 'DRAFT') && (
                    <Button
                      variant="ghost"
                      onClick={() => void run(() => api.publishing.reopen(detail.id))}
                      disabled={busy}
                    >
                      Repasser en brouillon
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => void run(() => api.publishing.duplicate(detail.id))}
                    disabled={busy}
                  >
                    Dupliquer
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void api.publishing
                        .export(detail.id)
                        .then(setExported)
                        .catch((cause: unknown) =>
                          setError(cause instanceof Error ? cause.message : 'Export impossible'),
                        )
                    }
                  >
                    Exporter
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      void api.publishing
                        .remove(detail.id)
                        .then(() => {
                          setDetail(null);
                          return load();
                        })
                        .catch((cause: unknown) =>
                          setError(
                            cause instanceof Error ? cause.message : 'Suppression impossible',
                          ),
                        );
                    }}
                    disabled={busy}
                  >
                    Supprimer
                  </Button>
                </div>

                {canTransition(detail.status, 'SCHEDULED') && (
                  <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                    <label className="block space-y-1.5">
                      <span className="block text-xs text-text-muted">
                        Programmer ({detail.timezone})
                      </span>
                      <input
                        type="datetime-local"
                        value={scheduleAt}
                        onChange={(event) => setScheduleAt(event.target.value)}
                        className="rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
                      />
                    </label>
                    <Button
                      variant="ghost"
                      disabled={busy || !scheduleAt}
                      onClick={() =>
                        void run(() =>
                          api.publishing.schedule(detail.id, {
                            scheduledAt: new Date(scheduleAt).toISOString(),
                            timezone: detail.timezone,
                          }),
                        )
                      }
                    >
                      Programmer
                    </Button>
                  </div>
                )}

                {canTransition(detail.status, 'REJECTED') && (
                  <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                    <label className="block flex-1 space-y-1.5">
                      <span className="block text-xs text-text-muted">Motif du refus</span>
                      <input
                        value={rejectReason}
                        onChange={(event) => setRejectReason(event.target.value)}
                        className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
                      />
                    </label>
                    <Button
                      variant="danger"
                      disabled={busy || rejectReason.trim().length < 3}
                      onClick={() =>
                        void run(() =>
                          api.publishing.reject(detail.id, { reason: rejectReason.trim() }),
                        )
                      }
                    >
                      Refuser
                    </Button>
                  </div>
                )}
              </Card>

              {detail.alternatives.length > 0 && (
                <Card className="space-y-2">
                  <h2 className="text-sm font-semibold">Solutions de repli</h2>
                  <ul className="space-y-2">
                    {detail.alternatives.map((alternative) => (
                      <li
                        key={`${alternative.kind}-${alternative.label}`}
                        className="rounded-lg border border-border px-3 py-2"
                      >
                        <p className="text-sm font-medium">{alternative.label}</p>
                        <p className="text-xs text-text-muted">{alternative.detail}</p>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {exported && (
                <Card className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Texte à publier manuellement</h2>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void navigator.clipboard.writeText(
                          exported.targets
                            .map(
                              (target) =>
                                `${socialPlatformLabels[target.platform]}\n${target.text}`,
                            )
                            .join('\n\n---\n\n'),
                        )
                      }
                    >
                      Copier tout
                    </Button>
                  </div>
                  {exported.targets.map((target) => (
                    <div key={`${target.platform}-${target.username}`} className="space-y-1">
                      <p className="text-xs text-text-muted">
                        {socialPlatformLabels[target.platform]} · {target.username} —{' '}
                        {target.charCount}/{target.charLimit}
                      </p>
                      <pre className="whitespace-pre-wrap rounded-lg border border-border bg-bg p-3 text-xs">
                        {target.text}
                      </pre>
                    </div>
                  ))}
                </Card>
              )}

              <Card className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Cibles</h2>
                  <Button variant="ghost" onClick={() => void saveTargets()} disabled={busy}>
                    Enregistrer les textes
                  </Button>
                </div>

                {detail.targets.map((target) => {
                  const draft = drafts[target.id];
                  const spec = platformSpecs[target.platform];
                  return (
                    <div key={target.id} className="space-y-2 rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">
                          {socialPlatformLabels[target.platform]} · {target.username}
                        </p>
                        <span
                          className={`text-xs ${
                            target.errors.length > 0
                              ? 'text-danger'
                              : target.charCount > spec.recommendedChars
                                ? 'text-accent'
                                : 'text-success'
                          }`}
                        >
                          {target.charCount}/{target.charLimit}
                        </span>
                      </div>

                      {target.errors.map((message) => (
                        <p key={message} className="text-xs text-danger">
                          {message}
                        </p>
                      ))}
                      {target.warnings.map((message) => (
                        <p key={message} className="text-xs text-accent">
                          {message}
                        </p>
                      ))}

                      {draft && (
                        <>
                          <textarea
                            value={draft.body}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [target.id]: { ...draft, body: event.target.value },
                              }))
                            }
                            rows={4}
                            className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              value={draft.title}
                              onChange={(event) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [target.id]: { ...draft, title: event.target.value },
                                }))
                              }
                              placeholder="Titre (si la plateforme en affiche un)"
                              className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
                            />
                            <input
                              value={draft.hashtags}
                              onChange={(event) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [target.id]: { ...draft, hashtags: event.target.value },
                                }))
                              }
                              placeholder="#hashtags"
                              className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
                            />
                          </div>
                        </>
                      )}

                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-text-muted">
                          Cible : {publicationStatusLabels[detail.status]} / {target.status}
                        </span>
                        {target.externalUrl && (
                          <a
                            href={target.externalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent underline-offset-2 hover:underline"
                          >
                            Voir la publication
                          </a>
                        )}
                      </div>
                      {target.error && <p className="text-xs text-danger">{target.error}</p>}

                      {(detail.status === 'PUBLISHING' || detail.status === 'FAILED') &&
                        target.status !== 'PUBLISHED' && (
                          <div className="flex items-end gap-2">
                            <input
                              value={confirmUrls[target.id] ?? ''}
                              onChange={(event) =>
                                setConfirmUrls((current) => ({
                                  ...current,
                                  [target.id]: event.target.value,
                                }))
                              }
                              placeholder="URL de la publication manuelle"
                              className="flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
                            />
                            <Button
                              variant="ghost"
                              disabled={busy || !(confirmUrls[target.id] ?? '').startsWith('http')}
                              onClick={() =>
                                void run(() =>
                                  api.publishing.confirm(detail.id, {
                                    targets: [
                                      { targetId: target.id, url: confirmUrls[target.id] ?? '' },
                                    ],
                                  }),
                                )
                              }
                            >
                              Confirmer
                            </Button>
                          </div>
                        )}
                    </div>
                  );
                })}
              </Card>

              <PublicationHistory publicationId={detail.id} />

              <CommentThread publicationId={detail.id} role={role} userId={userId} />

              <PublicationTasks publicationId={detail.id} role={role} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
