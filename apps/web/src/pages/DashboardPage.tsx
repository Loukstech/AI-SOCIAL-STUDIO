import { useEffect, useState } from 'react';
import type { DashboardStats } from '@ass/shared';
import { Icon, pageIcon, type IconName } from '../components/icons';
import { Alert, Button, Card, formatDate, PageHeader } from '../components/ui';
import { api } from '../lib/api';

type Tone = 'accent' | 'success' | 'warning' | 'danger';

const toneStyles: Record<Tone, { chip: string; bar: string; text: string }> = {
  accent: { chip: 'bg-accent/12 text-accent', bar: 'bg-accent', text: 'text-accent' },
  success: { chip: 'bg-success/12 text-success', bar: 'bg-success', text: 'text-success' },
  warning: { chip: 'bg-warning/12 text-warning', bar: 'bg-warning', text: 'text-warning' },
  danger: { chip: 'bg-danger/12 text-danger', bar: 'bg-danger', text: 'text-danger' },
};

function StatCard({
  label,
  value,
  icon,
  tone,
  delay = 0,
  compact = false,
}: {
  label: string;
  value: number | string;
  icon: IconName;
  tone: Tone;
  delay?: number;
  compact?: boolean;
}) {
  return (
    <Card
      className={`fade-in-up group relative overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-accent/5 ${
        compact ? 'p-4' : ''
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className={`absolute inset-x-0 top-0 h-0.5 ${toneStyles[tone].bar}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={`font-medium uppercase tracking-wide text-text-muted ${
              compact ? 'text-[10px]' : 'text-xs'
            }`}
          >
            {label}
          </p>
          <p className={`mt-2 font-semibold tabular-nums ${compact ? 'text-2xl' : 'text-3xl'}`}>
            {value}
          </p>
        </div>
        <span
          className={`flex shrink-0 items-center justify-center rounded-xl ${toneStyles[tone].chip} ${
            compact ? 'h-9 w-9' : 'h-11 w-11'
          }`}
        >
          <Icon name={icon} className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
        </span>
      </div>
    </Card>
  );
}

const quickActions: { label: string; page: string; tone: Tone }[] = [
  { label: 'Créer ou sélectionner une organisation', page: 'organizations', tone: 'accent' },
  { label: 'Configurer une marque', page: 'brands', tone: 'success' },
  { label: 'Ajouter un média à la bibliothèque', page: 'media', tone: 'warning' },
  { label: 'Connecter un compte social', page: 'social', tone: 'accent' },
  { label: 'Lancer un projet vidéo', page: 'video', tone: 'danger' },
  { label: 'Générer un contenu multiréseaux', page: 'content', tone: 'success' },
  { label: 'Générer un visuel', page: 'image', tone: 'warning' },
  { label: 'Soumettre une publication', page: 'publishing', tone: 'accent' },
  { label: 'Programmer dans le calendrier', page: 'calendar', tone: 'success' },
  { label: 'Mesurer les performances', page: 'analytics', tone: 'warning' },
];

function activityTone(action: string): Tone {
  if (action.includes('social')) return 'accent';
  if (action.includes('organization') || action.includes('member') || action.includes('invitation'))
    return 'success';
  if (action.includes('publication')) return 'warning';
  return 'danger';
}

function readableAction(action: string): string {
  return action.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function DashboardPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api
      .dashboard()
      .then((data) => active && setStats(data))
      .catch(
        (cause: unknown) =>
          active && setError(String(cause instanceof Error ? cause.message : cause)),
      );
    return () => {
      active = false;
    };
  }, []);

  type StatKey = Exclude<keyof DashboardStats, 'recentActivity'>;
  const value = (key: StatKey): number | '—' => (stats ? stats[key] : '—');

  const chart = [
    { label: 'Marques', value: stats?.brands ?? 0, tone: 'accent' as Tone },
    { label: 'Médias', value: stats?.media ?? 0, tone: 'success' as Tone },
    { label: 'Comptes', value: stats?.socialAccounts ?? 0, tone: 'warning' as Tone },
    { label: 'Vidéos', value: stats?.videoProjects ?? 0, tone: 'accent' as Tone },
    { label: 'Contenus', value: stats?.contentProjects ?? 0, tone: 'success' as Tone },
    { label: 'Visuels', value: stats?.imageProjects ?? 0, tone: 'warning' as Tone },
  ];
  const max = Math.max(1, ...chart.map((row) => row.value));

  const totalPublications = stats?.publications ?? 0;
  const scheduled = stats?.scheduledPublications ?? 0;
  const pending = Math.max(0, totalPublications - scheduled);
  const ratio = totalPublications > 0 ? Math.min(1, scheduled / totalPublications) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tableau de bord"
        description="Vue d'ensemble de votre espace de travail."
        action={
          <Button onClick={() => onNavigate('content')}>
            <Icon name="sparkles" className="h-4 w-4" />
            Nouveau contenu
          </Button>
        }
      />
      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Organisations"
          value={value('organizations')}
          icon="organizations"
          tone="accent"
          delay={0}
        />
        <StatCard label="Marques" value={value('brands')} icon="brands" tone="success" delay={60} />
        <StatCard label="Médias" value={value('media')} icon="media" tone="warning" delay={120} />
        <StatCard
          label="Contenus générés"
          value={value('contentProjects')}
          icon="content"
          tone="danger"
          delay={180}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Membres"
          value={value('members')}
          icon="social"
          tone="accent"
          delay={200}
          compact
        />
        <StatCard
          label="Comptes sociaux"
          value={value('socialAccounts')}
          icon="social"
          tone="success"
          delay={240}
          compact
        />
        <StatCard
          label="Projets vidéo"
          value={value('videoProjects')}
          icon="video"
          tone="warning"
          delay={280}
          compact
        />
        <StatCard
          label="Visuels générés"
          value={value('imageProjects')}
          icon="image"
          tone="danger"
          delay={320}
          compact
        />
        <StatCard
          label="Publications"
          value={value('publications')}
          icon="publishing"
          tone="accent"
          delay={360}
          compact
        />
        <StatCard
          label="Programmées"
          value={value('scheduledPublications')}
          icon="calendar"
          tone="success"
          delay={400}
          compact
        />
        <StatCard
          label="Invitations en attente"
          value={value('pendingInvitations')}
          icon="mail"
          tone="warning"
          delay={440}
          compact
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="fade-in-up" key="chart">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Activité de l'espace</h2>
              <p className="mt-1 text-xs text-text-muted">Répartition réelle des ressources</p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/12 text-accent">
              <Icon name="analytics" className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-6 space-y-3">
            {chart.map((row, index) => (
              <div
                key={row.label}
                className="grid grid-cols-[84px_1fr_28px] items-center gap-3 text-xs"
              >
                <span className="truncate text-text-muted">{row.label}</span>
                <div className="h-2 overflow-hidden rounded-full bg-bg">
                  <div
                    className={`h-full rounded-full ${toneStyles[row.tone].bar} transition-[width] duration-700 ease-out`}
                    style={{
                      width: `${row.value > 0 ? Math.max(4, (row.value / max) * 100) : 0}%`,
                      transitionDelay: `${index * 60}ms`,
                    }}
                  />
                </div>
                <span className="text-right font-medium tabular-nums">{row.value}</span>
              </div>
            ))}
          </div>
          {totalPublications === 0 && (
            <p className="mt-5 text-xs text-text-muted">
              Les barres se rempliront au fur et à mesure de votre activité.
            </p>
          )}
        </Card>

        <Card className="fade-in-up" key="pipeline">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Pipeline de publication</h2>
              <p className="mt-1 text-xs text-text-muted">Ce qui est déjà planifié</p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-success/12 text-success">
              <Icon name="calendar" className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-6">
            <div
              className="relative h-32 w-32 shrink-0 rounded-full transition-[background] duration-700"
              style={{
                background: `conic-gradient(var(--accent) ${ratio * 360}deg, var(--border) 0deg)`,
              }}
            >
              <div className="absolute inset-3 flex flex-col items-center justify-center rounded-full bg-surface">
                <span className="text-2xl font-semibold tabular-nums">{scheduled}</span>
                <span className="text-[10px] text-text-muted">programmées</span>
              </div>
            </div>
            <div className="min-w-[140px] space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-accent" />
                <span className="text-text-muted">Programmées</span>
                <span className="ml-auto font-medium tabular-nums">{scheduled}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full border border-border" />
                <span className="text-text-muted">À planifier</span>
                <span className="ml-auto font-medium tabular-nums">{pending}</span>
              </div>
              <p className="border-t border-border pt-3 text-xs text-text-muted">
                {totalPublications} publication{totalPublications > 1 ? 's' : ''} au total
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="fade-in-up" key="start">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Démarrer</h2>
              <p className="mt-1 text-xs text-text-muted">Les actions les plus utiles</p>
            </div>
            <Icon name="sparkles" className="h-5 w-5 text-accent" />
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {quickActions.map((action, index) => (
              <button
                key={action.page}
                type="button"
                onClick={() => onNavigate(action.page)}
                className="group flex items-center gap-3 rounded-xl border border-border bg-bg/40 p-3 text-left text-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:bg-accent/5"
                style={{ transitionDelay: `${index * 20}ms` }}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneStyles[action.tone].chip}`}
                >
                  <Icon name={pageIcon[action.page] ?? 'sparkles'} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{action.label}</span>
                <Icon
                  name="panelOpen"
                  className="h-3.5 w-3.5 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100"
                />
              </button>
            ))}
          </div>
        </Card>

        <Card className="fade-in-up" key="activity">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Activité récente</h2>
              <p className="mt-1 text-xs text-text-muted">Dernières actions enregistrées</p>
            </div>
            <Icon name="system" className="h-5 w-5 text-text-muted" />
          </div>
          {!stats || stats.recentActivity.length === 0 ? (
            <p className="py-12 text-center text-sm text-text-muted">
              Aucune activité pour l'instant.
            </p>
          ) : (
            <ul className="mt-5 space-y-4">
              {stats.recentActivity.map((log) => (
                <li key={log.id} className="flex gap-3">
                  <span className="relative mt-1 flex h-3 w-3 shrink-0">
                    <span
                      className={`absolute inline-flex h-full w-full rounded-full opacity-30 ${toneStyles[activityTone(log.action)].bar}`}
                    />
                    <span
                      className={`relative inline-flex h-3 w-3 rounded-full ${toneStyles[activityTone(log.action)].bar}`}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-sm font-medium">{readableAction(log.action)}</span>
                      <span className="text-[11px] text-text-muted">
                        {formatDate(log.createdAt)}
                      </span>
                    </div>
                    {log.targetType && (
                      <span className="text-[11px] text-text-muted">{log.targetType}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
