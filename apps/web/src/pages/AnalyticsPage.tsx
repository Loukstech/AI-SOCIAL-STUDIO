import { useEffect, useState, type FormEvent } from 'react';
import type {
  AnalyticsOverview,
  Brand,
  EngagementResult,
  Measurement,
  MetricAggregate,
  MetricField,
  Publication,
  PublicationDetail,
  Ranking,
  TopPublications,
} from '@ass/shared';
import { metricFields, metricLabels, metricSourceLabels, socialPlatformLabels } from '@ass/shared';
import { api } from '../lib/api';
import { downloadBlob } from '../lib/png-export';
import { Alert, Button, Card, Empty, Field, formatDate, PageHeader } from '../components/ui';

const RANKINGS: { id: Ranking; label: string }[] = [
  { id: 'ENGAGEMENT', label: 'Taux d’engagement' },
  { id: 'VIEWS', label: 'Vues' },
  { id: 'IMPRESSIONS', label: 'Impressions' },
  { id: 'INTERACTIONS', label: 'Interactions' },
];

const numberFormat = new Intl.NumberFormat('fr-FR');

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  return isoDay(new Date(Date.now() - days * 86_400_000));
}

/** Une métrique absente s'affiche « — », jamais « 0 ». */
function metricText(aggregate: MetricAggregate | undefined): string {
  return aggregate && aggregate.value !== null ? numberFormat.format(aggregate.value) : '—';
}

function coverageText(aggregate: MetricAggregate | undefined, total: number): string | null {
  if (!aggregate || aggregate.value === null || total === 0) return null;
  return aggregate.contributors === total
    ? null
    : `${aggregate.contributors} mesure(s) sur ${total}`;
}

function engagementText(engagement: EngagementResult | null): string {
  if (!engagement || engagement.value === null) return '—';
  const percent = (engagement.value * 100).toFixed(2).replace('.', ',');
  const basis = engagement.basis === 'reach' ? 'portée' : 'impressions';
  return `${percent} % des ${basis}`;
}

/**
 * Infobulle du taux : soit le motif de son indisponibilité, soit le nombre de
 * mesures réellement entrées dans le calcul. Un taux calculé sur 3 mesures
 * complètes parmi 12 ne doit pas se présenter comme portant sur les 12.
 */
function engagementHint(engagement: EngagementResult | null, total: number): string {
  if (!engagement || engagement.value === null) {
    return engagement?.reason ?? 'Aucune mesure disponible';
  }
  if (engagement.basedOn <= 1) return 'Calculé sur une mesure complète';
  return `Calculé sur ${engagement.basedOn} mesure(s) complète(s) parmi ${total} retenue(s)`;
}

export function AnalyticsPage() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(isoDay(new Date()));
  const [brandId, setBrandId] = useState('');
  const [rankedBy, setRankedBy] = useState<Ranking>('ENGAGEMENT');

  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [top, setTop] = useState<TopPublications | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [publications, setPublications] = useState<Publication[]>([]);

  const [selected, setSelected] = useState<PublicationDetail | null>(null);
  const [targetId, setTargetId] = useState('');
  const [values, setValues] = useState<Record<MetricField, string>>(emptyValues);
  const [collectedAt, setCollectedAt] = useState(isoDay(new Date()));
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<Measurement[]>([]);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const query = { from, to, ...(brandId ? { brandId } : {}) };

  useEffect(() => {
    let active = true;
    // La requête est reconstruite ici : un objet recréé à chaque rendu ne peut
    // pas figurer dans les dépendances sans boucler.
    const filters = { from, to, ...(brandId ? { brandId } : {}) };
    Promise.all([
      api.analytics.overview(filters),
      api.analytics.top({ ...filters, rankedBy }),
      api.brands.list(),
      api.publishing.list({ status: 'PUBLISHED', limit: 100 }),
    ])
      .then(([overviewData, topData, brandList, publicationList]) => {
        if (!active) return;
        setOverview(overviewData);
        setTop(topData);
        setBrands(brandList);
        setPublications(publicationList.items);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Erreur de chargement');
      });
    return () => {
      active = false;
    };
  }, [from, to, brandId, rankedBy, reload]);

  async function selectPublication(id: string) {
    setSelected(null);
    setTargetId('');
    setHistory([]);
    if (!id) return;
    try {
      const detail = await api.publishing.detail(id);
      setSelected(detail);
      setTargetId(detail.targets.find((target) => target.status === 'PUBLISHED')?.id ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Publication illisible');
    }
  }

  async function loadHistory(publicationId: string, target: string) {
    if (!publicationId || !target) return;
    try {
      setHistory(await api.analytics.history(publicationId, target));
    } catch {
      setHistory([]);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || !targetId) return;
    setError('');
    setNotice('');
    setBusy('record');
    try {
      const metrics: Record<string, number> = {};
      for (const field of metricFields) {
        const raw = values[field].trim();
        if (raw === '') continue;
        metrics[field] = Number(raw);
      }
      await api.analytics.record({
        publicationId: selected.id,
        targetId,
        collectedAt: new Date(`${collectedAt}T12:00:00`).toISOString(),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...metrics,
      });
      setValues(emptyValues());
      setNote('');
      setNotice('Mesure enregistrée. Les totaux de la période en tiennent compte.');
      await loadHistory(selected.id, targetId);
      setReload((n) => n + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enregistrement impossible');
    } finally {
      setBusy(null);
    }
  }

  async function collect() {
    setError('');
    setNotice('');
    setBusy('collect');
    try {
      const result = await api.analytics.collect();
      const reason = result.skipped[0]?.reason ?? '';
      setNotice(
        result.collected === 0
          ? `Aucune statistique récupérée : ${result.attempted} cible(s) examinée(s). ${reason}`
          : `${result.collected} mesure(s) récupérée(s) sur ${result.attempted} cible(s).`,
      );
      setReload((n) => n + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Collecte impossible');
    } finally {
      setBusy(null);
    }
  }

  async function exportCsv() {
    setError('');
    setBusy('export');
    try {
      const csv = await api.analytics.exportCsv(query);
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `analytics-${to}.csv`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export impossible');
    } finally {
      setBusy(null);
    }
  }

  const measurements = overview
    ? overview.networks.reduce((sum, row) => sum + row.measurements, 0)
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Ce que les publications ont réellement produit. Chaque chiffre porte sa provenance et sa date ; une métrique indisponible reste vide plutôt qu’estimée."
      />
      {error && <Alert>{error}</Alert>}
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent"
        >
          {notice}
        </p>
      )}

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field
            label="Du"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Field
            label="Au"
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Marque</span>
            <select
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="">Toutes</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Classement</span>
            <select
              value={rankedBy}
              onChange={(e) => setRankedBy(e.target.value as Ranking)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            >
              {RANKINGS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void exportCsv()}
            >
              {busy === 'export' ? 'Export…' : 'Exporter CSV'}
            </Button>
          </div>
        </div>
      </Card>

      {overview && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="flex flex-col gap-1">
              <span className="text-sm text-text-muted">Publications sur la période</span>
              <span className="text-3xl font-semibold tabular-nums">{overview.publications}</span>
              <span className="text-xs text-text-muted">
                {overview.measured} mesurée(s) · {measurements} mesure(s) retenue(s)
              </span>
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="text-sm text-text-muted">Taux d’engagement global</span>
              <span className="text-3xl font-semibold tabular-nums">
                {engagementText(overview.engagement)}
              </span>
              <span className="text-xs text-text-muted">
                {overview.engagement.reason ??
                  (overview.engagement.basedOn > 1
                    ? `Calculé sur ${overview.engagement.basedOn} mesure(s) complète(s)`
                    : 'Calculé sur les sommes de la période')}
              </span>
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="text-sm text-text-muted">Audience</span>
              <span className="text-lg font-medium text-text-muted">Non disponible</span>
              <span className="text-xs text-text-muted">{overview.audience.reason}</span>
            </Card>
          </div>

          {overview.notes.length > 0 && (
            <Card className="border-warning/40 bg-warning/5">
              <h2 className="mb-2 text-sm font-medium text-warning">Limites de ces chiffres</h2>
              <ul className="list-inside list-disc space-y-1 text-xs text-text-muted">
                {overview.notes.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <h2 className="mb-4 font-medium">Comparaison des réseaux</h2>
            {overview.networks.length === 0 ? (
              <Empty>Aucune mesure sur cette période. Saisissez un relevé pour commencer.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-text-muted">
                    <tr className="border-b border-border">
                      <th className="py-2 pr-3 font-medium">Réseau</th>
                      <th className="py-2 pr-3 font-medium">Publications</th>
                      {metricFields.map((field) => (
                        <th key={field} className="py-2 pr-3 text-right font-medium">
                          {metricLabels[field]}
                        </th>
                      ))}
                      <th className="py-2 font-medium">Engagement</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border bg-bg/40 font-medium">
                      <td className="py-2 pr-3">Total</td>
                      <td className="py-2 pr-3">{overview.measured}</td>
                      {metricFields.map((field) => (
                        <td
                          key={field}
                          className="py-2 pr-3 text-right tabular-nums"
                          title={coverageText(overview.totals[field], measurements) ?? 'Complet'}
                        >
                          {metricText(overview.totals[field])}
                        </td>
                      ))}
                      <td
                        className="py-2"
                        title={engagementHint(overview.engagement, measurements)}
                      >
                        {engagementText(overview.engagement)}
                      </td>
                    </tr>
                    {overview.networks.map((row) => (
                      <tr key={row.platform} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-3">{row.label}</td>
                        <td className="py-2 pr-3">
                          {row.publications}
                          <span className="block text-xs text-text-muted">
                            {row.lastCollectedAt
                              ? `relevé le ${formatDate(row.lastCollectedAt)}`
                              : '—'}
                          </span>
                        </td>
                        {metricFields.map((field) => (
                          <td
                            key={field}
                            className="py-2 pr-3 text-right tabular-nums"
                            title={coverageText(row.metrics[field], row.measurements) ?? 'Complet'}
                          >
                            {metricText(row.metrics[field])}
                          </td>
                        ))}
                        <td
                          className="py-2"
                          title={engagementHint(row.engagement, row.measurements)}
                        >
                          {engagementText(row.engagement)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {overview.sources.length > 0 && (
              <p className="mt-4 text-xs text-text-muted">
                Provenance :{' '}
                {overview.sources
                  .map(
                    (source) =>
                      `${metricSourceLabels[source.source]} (${source.measurements}${
                        source.lastSyncedAt ? `, ${formatDate(source.lastSyncedAt)}` : ''
                      })`,
                  )
                  .join(' · ')}
              </p>
            )}
          </Card>

          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">Meilleurs contenus</h2>
              <span className="text-xs text-text-muted">
                Classés par {RANKINGS.find((option) => option.id === rankedBy)?.label.toLowerCase()}
              </span>
            </div>
            {!top || top.items.length === 0 ? (
              <Empty>Aucun contenu mesuré ne peut être classé sur cette période.</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {top.items.map((item) => (
                  <li
                    key={item.targetId}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium">
                        {item.title ?? 'Sans titre'} · {socialPlatformLabels[item.platform]} @
                        {item.username}
                      </p>
                      <p className="text-xs text-text-muted">
                        {item.publishedAt
                          ? `publié le ${formatDate(item.publishedAt)}`
                          : 'date de publication inconnue'}
                        {` · ${metricSourceLabels[item.source]}`}
                        {` · relevé le ${formatDate(item.collectedAt)}`}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <span className="font-medium" title={engagementHint(item.engagement, 1)}>
                        {engagementText(item.engagement)}
                      </span>
                      <span className="block text-xs text-text-muted">
                        {metricText(item.metrics.views)} vues · {metricText(item.metrics.likes)}{' '}
                        likes
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {top && top.notes.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-text-muted">
                {top.notes.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Saisir un relevé</h2>
          <Button
            type="button"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => void collect()}
          >
            {busy === 'collect' ? 'Collecte…' : 'Récupérer depuis les plateformes'}
          </Button>
        </div>
        <p className="mb-4 text-xs text-text-muted">
          La collecte automatique exige un adaptateur natif par plateforme. Sans lui, chaque cible
          est ignorée avec son motif — aucun chiffre n’est inventé.
        </p>

        {publications.length === 0 ? (
          <Empty>Aucune publication confirmée à mesurer pour l’instant.</Empty>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">Publication</span>
                <select
                  value={selected?.id ?? ''}
                  onChange={(e) => void selectPublication(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  <option value="">Choisir…</option>
                  {publications.map((publication) => (
                    <option key={publication.id} value={publication.id}>
                      {(publication.title ?? 'Sans titre') +
                        ` · ${publication.platforms.map((platform) => socialPlatformLabels[platform]).join(', ')}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">Cible</span>
                <select
                  value={targetId}
                  onChange={(e) => {
                    setTargetId(e.target.value);
                    if (selected) void loadHistory(selected.id, e.target.value);
                  }}
                  disabled={!selected}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
                >
                  <option value="">Choisir…</option>
                  {selected?.targets
                    .filter((target) => target.status === 'PUBLISHED')
                    .map((target) => (
                      <option key={target.id} value={target.id}>
                        {socialPlatformLabels[target.platform]} @{target.username}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              {metricFields.map((field) => (
                <Field
                  key={field}
                  label={metricLabels[field]}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={values[field]}
                  onChange={(e) =>
                    setValues((current) => ({ ...current, [field]: e.target.value }))
                  }
                  placeholder="—"
                />
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Date du relevé"
                type="date"
                value={collectedAt}
                onChange={(e) => setCollectedAt(e.target.value)}
                hint="La date à laquelle les chiffres ont été observés sur la plateforme."
              />
              <Field
                label="Note (facultatif)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="ex. relevé sur le tableau de bord LinkedIn"
              />
            </div>

            <Button type="submit" disabled={busy !== null || !targetId}>
              {busy === 'record' ? 'Enregistrement…' : 'Enregistrer la mesure'}
            </Button>
          </form>
        )}

        {history.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-medium">Historique de cette cible</h3>
            <ul className="space-y-1 text-xs text-text-muted">
              {history.map((entry) => (
                <li key={entry.id}>
                  {formatDate(entry.collectedAt)} · {metricSourceLabels[entry.source]} ·{' '}
                  {metricFields
                    .filter((field) => typeof entry[field] === 'number')
                    .map(
                      (field) => `${metricLabels[field]} ${numberFormat.format(entry[field] ?? 0)}`,
                    )
                    .join(' · ')}
                  {entry.note ? ` — ${entry.note}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

function emptyValues(): Record<MetricField, string> {
  return Object.fromEntries(metricFields.map((field) => [field, ''])) as Record<
    MetricField,
    string
  >;
}
