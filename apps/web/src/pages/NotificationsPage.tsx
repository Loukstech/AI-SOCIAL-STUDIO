import { useEffect, useState } from 'react';
import type {
  Notification as AppNotification,
  NotificationCatalogResponse,
  NotificationList,
  NotificationPreference,
  NotificationType,
} from '@ass/shared';
import {
  badgeLabel,
  notificationEmailStatusLabels,
  notificationTypeLabels,
  occurrencesLabel,
} from '@ass/shared';
import { api } from '../lib/api';
import { Alert, Button, Card, Empty, PageHeader, formatDate } from '../components/ui';

/**
 * Notifications (§15).
 *
 * L'écran assume deux choses que l'API dit déjà : les événements qui ne sont
 * pas encore émis le sont **avec leur motif**, et le canal e-mail est annoncé
 * comme non configuré tant qu'aucun transport n'existe. Aucun réglage affiché
 * ici ne promet un envoi qui n'a pas lieu.
 */
export function NotificationsPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [data, setData] = useState<NotificationList | null>(null);
  const [catalog, setCatalog] = useState<NotificationCatalogResponse | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [saved, setSaved] = useState<NotificationPreference[]>([]);

  const [unreadOnly, setUnreadOnly] = useState(false);
  const [type, setType] = useState<NotificationType | ''>('');
  const [reloadKey, setReloadKey] = useState(0);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // Catalogue et préférences ne dépendent pas des filtres : chargés une fois.
  useEffect(() => {
    let active = true;
    Promise.all([api.notifications.catalog(), api.notifications.preferences()])
      .then(([cat, prefs]) => {
        if (!active) return;
        setCatalog(cat);
        setPreferences(prefs);
        setSaved(prefs);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : 'Chargement impossible');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const filters = {
      ...(unreadOnly ? { unread: true } : {}),
      ...(type ? { type } : {}),
    };
    api.notifications
      .list(filters)
      .then((list) => {
        if (active) setData(list);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : 'Chargement impossible');
      });
    return () => {
      active = false;
    };
  }, [unreadOnly, type, reloadKey]);

  const refresh = () => setReloadKey((value) => value + 1);

  async function markRead(notification: AppNotification) {
    setBusy(notification.id);
    setError('');
    try {
      await api.notifications.read(notification.id);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action impossible');
    } finally {
      setBusy(null);
    }
  }

  async function markAll() {
    setBusy('all');
    setError('');
    try {
      await api.notifications.readAll();
      setNotice('Toutes les notifications sont marquées comme lues.');
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action impossible');
    } finally {
      setBusy(null);
    }
  }

  async function remove(notification: AppNotification) {
    setBusy(notification.id);
    setError('');
    try {
      await api.notifications.remove(notification.id);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Suppression impossible');
    } finally {
      setBusy(null);
    }
  }

  /** Seules les lignes réellement modifiées sont envoyées. */
  async function savePreferences() {
    const changes = preferences
      .filter((entry) => {
        const previous = saved.find((item) => item.type === entry.type);
        return !previous || previous.inApp !== entry.inApp || previous.email !== entry.email;
      })
      .map((entry) => ({ type: entry.type, inApp: entry.inApp, email: entry.email }));

    if (changes.length === 0) {
      setNotice('Aucune préférence modifiée.');
      return;
    }

    setBusy('preferences');
    setError('');
    try {
      const updated = await api.notifications.savePreferences({ preferences: changes });
      setPreferences(updated);
      setSaved(updated);
      setNotice(`${changes.length} préférence(s) enregistrée(s).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enregistrement impossible');
    } finally {
      setBusy(null);
    }
  }

  function toggle(notificationType: NotificationType, channel: 'inApp' | 'email') {
    setPreferences((current) =>
      current.map((entry) =>
        entry.type === notificationType ? { ...entry, [channel]: !entry[channel] } : entry,
      ),
    );
  }

  const dirty = preferences.some((entry) => {
    const previous = saved.find((item) => item.type === entry.type);
    return !previous || previous.inApp !== entry.inApp || previous.email !== entry.email;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Ce qui s’est passé dans votre espace, et ce qui vous est réellement notifié."
        action={
          <div className="flex items-center gap-2">
            {data && data.unread > 0 && (
              <span className="rounded-full bg-accent/12 px-2.5 py-1 text-xs font-medium text-accent">
                {badgeLabel(data.unread)} non lue(s)
              </span>
            )}
            <Button
              variant="ghost"
              onClick={() => void markAll()}
              disabled={busy !== null || !data || data.unread === 0}
            >
              Tout marquer comme lu
            </Button>
          </div>
        }
      />

      {error && <Alert>{error}</Alert>}
      {notice && (
        <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">
          {notice}
        </p>
      )}

      {catalog && !catalog.email.available && (
        <Card className="border-warning/40 bg-warning/5">
          <h2 className="mb-2 text-sm font-medium text-warning">Canal e-mail indisponible</h2>
          <p className="text-xs text-text-muted">{catalog.email.reason}</p>
          <p className="mt-2 text-xs text-text-muted">
            La préférence e-mail est tout de même enregistrée : elle sera honorée le jour où un
            transport sera branché, sans que vous ayez à revenir ici.
          </p>
        </Card>
      )}

      {/* --- Boîte de réception --- */}
      <Card>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-medium">Boîte de réception</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(event) => setUnreadOnly(event.target.checked)}
                className="size-4 rounded border-border accent-accent"
              />
              Non lues seulement
            </label>
            <select
              value={type}
              onChange={(event) => setType(event.target.value as NotificationType | '')}
              className="rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
            >
              <option value="">Tous les types</option>
              {(catalog?.events ?? []).map((entry) => (
                <option key={entry.type} value={entry.type}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!data ? (
          <Empty>Chargement…</Empty>
        ) : data.items.length === 0 ? (
          <Empty>
            {unreadOnly || type
              ? 'Aucune notification ne correspond à ce filtre.'
              : 'Aucune notification pour le moment. Les événements de publication et les connexions tombées apparaîtront ici.'}
          </Empty>
        ) : (
          <ul className="divide-y divide-border">
            {data.items.map((item) => {
              const occurrences = occurrencesLabel(item.occurrences);
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 gap-3">
                    <span
                      aria-hidden
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${
                        item.readAt ? 'bg-border' : 'bg-accent'
                      }`}
                    />
                    <div className="min-w-0">
                      <p className={`text-sm ${item.readAt ? 'text-text-muted' : 'font-medium'}`}>
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-sm text-text-muted">{item.body}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                        <span className="rounded bg-bg px-1.5 py-0.5">
                          {notificationTypeLabels[item.type]}
                        </span>
                        <span>{formatDate(item.lastOccurredAt)}</span>
                        {occurrences && <span>· {occurrences}</span>}
                        {item.email.status !== 'NOT_REQUESTED' && (
                          <span title={item.email.reason ?? undefined}>
                            · {notificationEmailStatusLabels[item.email.status]}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {item.url && onNavigate && (
                      <Button
                        variant="ghost"
                        onClick={() => onNavigate(item.url!.replace('#', ''))}
                        className="px-2 py-1 text-xs"
                      >
                        Ouvrir
                      </Button>
                    )}
                    {!item.readAt && (
                      <Button
                        variant="ghost"
                        onClick={() => void markRead(item)}
                        disabled={busy !== null}
                        className="px-2 py-1 text-xs"
                      >
                        Marquer lu
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      onClick={() => void remove(item)}
                      disabled={busy !== null}
                      className="px-2 py-1 text-xs"
                    >
                      Supprimer
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {data && data.total > data.items.length && (
          <p className="mt-3 text-xs text-text-muted">
            {data.items.length} notification(s) affichée(s) sur {data.total}.
          </p>
        )}
      </Card>

      {/* --- Préférences --- */}
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-medium">Préférences</h2>
            <p className="text-xs text-text-muted">
              Par type d’événement, pour vous seul. Une préférence non touchée garde sa valeur par
              défaut.
            </p>
          </div>
          <Button onClick={() => void savePreferences()} disabled={busy !== null || !dirty}>
            Enregistrer
          </Button>
        </div>

        {preferences.length === 0 ? (
          <Empty>Chargement…</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Événement</th>
                  <th className="py-2 pr-3 text-center font-medium">Interne</th>
                  <th className="py-2 text-center font-medium">E-mail</th>
                </tr>
              </thead>
              <tbody>
                {preferences.map((entry) => (
                  <tr key={entry.type} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3">
                      {notificationTypeLabels[entry.type]}
                      {entry.customized && (
                        <span className="ml-2 rounded bg-bg px-1.5 py-0.5 text-[10px] text-text-muted">
                          personnalisé
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-center">
                      <input
                        type="checkbox"
                        checked={entry.inApp}
                        onChange={() => toggle(entry.type, 'inApp')}
                        aria-label={`Notification interne pour ${notificationTypeLabels[entry.type]}`}
                        className="size-4 rounded border-border accent-accent"
                      />
                    </td>
                    <td className="py-2 text-center">
                      <input
                        type="checkbox"
                        checked={entry.email}
                        onChange={() => toggle(entry.type, 'email')}
                        aria-label={`E-mail pour ${notificationTypeLabels[entry.type]}`}
                        className="size-4 rounded border-border accent-accent"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* --- Catalogue honnête du §15 --- */}
      <Card>
        <h2 className="mb-1 font-medium">Événements du cahier des charges</h2>
        <p className="mb-4 text-xs text-text-muted">
          Les dix événements du §15 sont listés. Ceux qui ne sont pas encore émis le disent, avec le
          sous-système qui manque — plutôt que de vous laisser attendre une notification qui
          n’arrivera jamais.
        </p>

        {!catalog ? (
          <Empty>Chargement…</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {catalog.events.map((entry) => (
              <li key={entry.type} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{entry.label}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      entry.wired ? 'bg-success/12 text-success' : 'bg-warning/12 text-warning'
                    }`}
                  >
                    {entry.wired ? 'Actif' : 'Non disponible'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-muted">{entry.description}</p>
                {entry.reason && <p className="mt-1 text-xs text-warning">{entry.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
