import { useCallback, useEffect, useState } from 'react';
import type {
  Brand,
  CalendarEntry,
  CalendarResponse,
  CalendarView,
  PublicationStatus,
  SocialAccount,
  SocialPlatform,
} from '@ass/shared';
import {
  publicationStatusLabels,
  publicationStatuses,
  socialPlatformLabels,
  socialPlatforms,
} from '@ass/shared';
import { api } from '../lib/api';
import { Alert, Button, Card, Empty, PageHeader } from '../components/ui';

/**
 * Content Calendar (§11).
 *
 * Le serveur renvoie les entrées et le fuseau de l'organisation. Le regroupement
 * par jour se fait avec ce fuseau, jamais avec celui du navigateur : sinon une
 * publication programmée à 00:30 apparaîtrait la veille pour un visiteur à Paris
 * consultant depuis Montréal.
 */

const VIEW_LABELS: Record<CalendarView, string> = {
  month: 'Mois',
  week: 'Semaine',
  day: 'Jour',
  list: 'Liste',
};

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function localDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

function dateKeyInTz(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function timeInTz(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function addDays(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function lastDayOfMonth(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10);
}

function mondayOf(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return addDays(key, -((weekday + 6) % 7));
}

function offsetMinutes(timezone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Convertit une heure murale du fuseau en instant UTC. */
function wallTimeToIso(dayKey: string, time: string, timezone: string): string {
  const naive = Date.parse(`${dayKey}T${time}:00Z`);
  const offset = offsetMinutes(timezone, new Date(naive));
  return new Date(naive - offset * 60_000).toISOString();
}

interface Window {
  from: string;
  to: string;
  days: string[];
}

function buildWindow(view: CalendarView, anchor: string): Window {
  if (view === 'day') {
    return {
      from: `${addDays(anchor, -1)}T00:00:00.000Z`,
      to: `${addDays(anchor, 1)}T23:59:59.999Z`,
      days: [anchor],
    };
  }
  if (view === 'week') {
    const first = mondayOf(anchor);
    const days = Array.from({ length: 7 }, (_, index) => addDays(first, index));
    return {
      from: `${addDays(first, -1)}T00:00:00.000Z`,
      to: `${addDays(first, 8)}T23:59:59.999Z`,
      days,
    };
  }
  if (view === 'list') {
    const days = Array.from({ length: 30 }, (_, index) => addDays(anchor, index));
    return {
      from: `${addDays(anchor, -1)}T00:00:00.000Z`,
      to: `${addDays(anchor, 31)}T23:59:59.999Z`,
      days,
    };
  }
  const first = `${anchor.slice(0, 8)}01`;
  const last = lastDayOfMonth(first);
  const gridStart = mondayOf(first);
  const cells =
    Math.ceil((Number(last.slice(8)) + new Date(`${first}T00:00:00Z`).getUTCDay() - 1) / 7) * 7;
  const days = Array.from({ length: Math.max(cells, 28) }, (_, index) => addDays(gridStart, index));
  return {
    from: `${addDays(gridStart, -1)}T00:00:00.000Z`,
    to: `${addDays(gridStart, days.length + 1)}T23:59:59.999Z`,
    days,
  };
}

export function CalendarPage() {
  const [view, setView] = useState<CalendarView>('month');
  const [anchor, setAnchor] = useState<string>(() => localDateKey(new Date()));
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [platform, setPlatform] = useState<SocialPlatform | ''>('');
  const [brandId, setBrandId] = useState('');
  const [status, setStatus] = useState<PublicationStatus | ''>('');
  const [error, setError] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);

  const [quickDay, setQuickDay] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickBody, setQuickBody] = useState('');
  const [quickAccount, setQuickAccount] = useState('');
  const [reload, setReload] = useState(0);

  const window = buildWindow(view, anchor);
  const { from, to } = window;

  const load = useCallback(() => {
    setReload((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.calendar.window({
        from,
        to,
        ...(platform ? { platform } : {}),
        ...(brandId ? { brandId } : {}),
        ...(status ? { status } : {}),
      }),
      api.socialAccounts.list(),
      api.brands.list(),
    ])
      .then(([response, accountList, brandList]) => {
        if (!active) return;
        setData(response);
        setAccounts(accountList);
        setBrands(brandList);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Calendrier indisponible');
      });
    return () => {
      active = false;
    };
  }, [from, to, platform, brandId, status, reload]);

  const timezone = data?.timezone ?? 'Europe/Paris';

  const byDay = new Map<string, CalendarEntry[]>();
  for (const entry of data?.entries ?? []) {
    const key = dateKeyInTz(entry.scheduledAt, timezone);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(entry);
    else byDay.set(key, [entry]);
  }

  async function drop(dayKey: string): Promise<void> {
    if (!dragId) return;
    const entry = (data?.entries ?? []).find((item) => item.id === dragId);
    setDragId(null);
    if (!entry) return;
    const time = timeInTz(entry.scheduledAt, timezone);
    setError('');
    try {
      await api.publishing.reschedule(entry.id, {
        scheduledAt: wallTimeToIso(dayKey, time, timezone),
        timezone,
      });
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Déplacement impossible');
    }
  }

  async function quickCreate(): Promise<void> {
    if (!quickDay || !quickAccount || !quickBody.trim()) {
      setError('Compte et texte sont requis pour une création rapide');
      return;
    }
    setError('');
    try {
      await api.publishing.create({
        ...(quickTitle.trim() ? { title: quickTitle.trim() } : {}),
        scheduledAt: wallTimeToIso(quickDay, '09:00', timezone),
        timezone,
        targets: [{ socialAccountId: quickAccount, body: quickBody }],
      });
      setQuickDay(null);
      setQuickTitle('');
      setQuickBody('');
      setQuickAccount('');
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Création impossible');
    }
  }

  function shift(step: number): void {
    if (view === 'month') {
      const [year, month] = anchor.split('-').map(Number);
      const target = new Date(Date.UTC(year!, month! - 1 + step, 1));
      setAnchor(target.toISOString().slice(0, 10));
      return;
    }
    setAnchor(addDays(anchor, step * (view === 'week' ? 7 : view === 'day' ? 1 : 30)));
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Calendrier éditorial"
        description={`Vues mois, semaine, jour et liste — fuseau de l’organisation : ${timezone}`}
        action={
          <div className="flex flex-wrap gap-1">
            {(Object.keys(VIEW_LABELS) as CalendarView[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setView(value)}
                className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  view === value
                    ? 'border-accent bg-accent/12 text-accent'
                    : 'border-border text-text-muted hover:text-text'
                }`}
              >
                {VIEW_LABELS[value]}
              </button>
            ))}
          </div>
        }
      />

      {error && <Alert>{error}</Alert>}

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => shift(-1)}>
            ←
          </Button>
          <Button variant="ghost" onClick={() => setAnchor(localDateKey(new Date()))}>
            Aujourd’hui
          </Button>
          <Button variant="ghost" onClick={() => shift(1)}>
            →
          </Button>
          <span className="ml-2 text-sm font-medium">
            {view === 'month'
              ? new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(
                  new Date(`${anchor.slice(0, 8)}01T12:00:00Z`),
                )
              : view === 'week'
                ? `Semaine du ${mondayOf(anchor)}`
                : view === 'day'
                  ? anchor
                  : `30 jours à partir du ${anchor}`}
          </span>

          <div className="ml-auto flex flex-wrap gap-2">
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value as SocialPlatform | '')}
              className="rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
            >
              <option value="">Tous les réseaux</option>
              {socialPlatforms.map((value) => (
                <option key={value} value={value}>
                  {socialPlatformLabels[value]}
                </option>
              ))}
            </select>
            {brands.length > 0 && (
              <select
                value={brandId}
                onChange={(event) => setBrandId(event.target.value)}
                className="rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
              >
                <option value="">Toutes les marques</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as PublicationStatus | '')}
              className="rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
            >
              <option value="">Tous les statuts</option>
              {publicationStatuses.map((value) => (
                <option key={value} value={value}>
                  {publicationStatusLabels[value]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {quickDay && (
          <div className="space-y-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
            <p className="text-xs font-medium text-accent">Création rapide au {quickDay}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={quickTitle}
                onChange={(event) => setQuickTitle(event.target.value)}
                placeholder="Titre interne"
                className="rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
              <select
                value={quickAccount}
                onChange={(event) => setQuickAccount(event.target.value)}
                className="rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
              >
                <option value="">Choisir un compte</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {socialPlatformLabels[account.platform]} · {account.username}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={quickBody}
              onChange={(event) => setQuickBody(event.target.value)}
              rows={3}
              placeholder="Texte de la publication"
              className="w-full resize-y rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <Button onClick={() => void quickCreate()}>Créer le brouillon</Button>
              <Button variant="ghost" onClick={() => setQuickDay(null)}>
                Annuler
              </Button>
            </div>
          </div>
        )}

        {view === 'list' ? (
          <ul className="divide-y divide-border">
            {(data?.entries ?? []).length === 0 && (
              <Empty>Aucune publication sur la période.</Empty>
            )}
            {(data?.entries ?? []).map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="w-32 shrink-0 tabular-nums text-text-muted">
                  {dateKeyInTz(entry.scheduledAt, timezone)} {timeInTz(entry.scheduledAt, timezone)}
                </span>
                <span className="flex-1 truncate">{entry.title ?? 'Sans titre'}</span>
                <span className="text-xs text-text-muted">
                  {entry.platforms.map((value) => socialPlatformLabels[value]).join(' · ')}
                </span>
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted">
                  {publicationStatusLabels[entry.status]}
                </span>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void api.publishing
                      .duplicate(entry.id)
                      .then(() => load())
                      .catch((cause: unknown) =>
                        setError(cause instanceof Error ? cause.message : 'Duplication impossible'),
                      )
                  }
                >
                  Dupliquer
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div
            className={`grid gap-1.5 ${
              view === 'day' ? 'grid-cols-1' : view === 'week' ? 'grid-cols-7' : 'grid-cols-7'
            }`}
          >
            {view !== 'day' &&
              WEEKDAYS.map((label) => (
                <div key={label} className="pb-1 text-center text-[11px] text-text-muted">
                  {label}
                </div>
              ))}
            {window.days.map((dayKey) => {
              const entries = byDay.get(dayKey) ?? [];
              const isAnchorMonth = dayKey.slice(0, 7) === anchor.slice(0, 7);
              return (
                <div
                  key={dayKey}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => void drop(dayKey)}
                  className={`min-h-24 rounded-lg border p-1.5 transition-colors ${
                    dragId ? 'border-accent/40 bg-accent/5' : 'border-border'
                  } ${view === 'month' && !isAnchorMonth ? 'opacity-50' : ''}`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] tabular-nums text-text-muted">
                      {Number(dayKey.slice(8))}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQuickDay(dayKey)}
                      title="Création rapide"
                      className="text-[11px] text-text-muted hover:text-accent"
                    >
                      +
                    </button>
                  </div>
                  <div className="space-y-1">
                    {entries.map((entry) => (
                      <div
                        key={entry.id}
                        draggable
                        onDragStart={() => setDragId(entry.id)}
                        onDragEnd={() => setDragId(null)}
                        className="cursor-grab rounded border border-border bg-bg px-1.5 py-1 text-[11px] leading-tight"
                        title={`${publicationStatusLabels[entry.status]} — glisser pour déplacer`}
                      >
                        <span className="block tabular-nums text-text-muted">
                          {timeInTz(entry.scheduledAt, timezone)}
                        </span>
                        <span className="block truncate">{entry.title ?? 'Sans titre'}</span>
                        <span className="block truncate text-text-muted">
                          {entry.platforms.map((value) => socialPlatformLabels[value]).join(' · ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
