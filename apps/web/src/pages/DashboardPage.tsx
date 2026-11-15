import { useEffect, useState } from 'react';
import type { DashboardStats } from '@ass/shared';
import { api } from '../lib/api';
import { Alert, Card, formatDate, PageHeader, Stat } from '../components/ui';

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tableau de bord"
        description="Vue d'ensemble de votre espace de travail."
      />
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Organisations" value={stats?.organizations ?? '—'} />
        <Stat label="Marques" value={stats?.brands ?? '—'} />
        <Stat label="Médias" value={stats?.media ?? '—'} />
        <Stat label="Membres" value={stats?.members ?? '—'} />
        <Stat label="Comptes sociaux" value={stats?.socialAccounts ?? '—'} />
        <Stat label="Projets vidéo" value={stats?.videoProjects ?? '—'} />
        <Stat label="Contenus générés" value={stats?.contentProjects ?? '—'} />
        <Stat label="Publications" value={stats?.publications ?? '—'} />
        <Stat label="Programmées" value={stats?.scheduledPublications ?? '—'} />
        <Stat label="Visuels générés" value={stats?.imageProjects ?? '—'} />
        <Stat label="Invitations en attente" value={stats?.pendingInvitations ?? '—'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-medium">Démarrer</h2>
          <ul className="space-y-2 text-sm">
            <li>
              <button
                className="text-accent hover:underline"
                onClick={() => onNavigate('organizations')}
              >
                → Créer ou sélectionner une organisation
              </button>
            </li>
            <li>
              <button className="text-accent hover:underline" onClick={() => onNavigate('brands')}>
                → Configurer une marque
              </button>
            </li>
            <li>
              <button className="text-accent hover:underline" onClick={() => onNavigate('media')}>
                → Ajouter un média à la bibliothèque
              </button>
            </li>
            <li>
              <button className="text-accent hover:underline" onClick={() => onNavigate('social')}>
                → Connecter un compte social
              </button>
            </li>
            <li>
              <button className="text-accent hover:underline" onClick={() => onNavigate('video')}>
                → Lancer un projet vidéo et ses sous-titres
              </button>
            </li>
            <li>
              <button className="text-accent hover:underline" onClick={() => onNavigate('content')}>
                → Générer un contenu multiréseaux
              </button>
            </li>
            <li>
              <button className="text-accent hover:underline" onClick={() => onNavigate('image')}>
                → Générer un visuel pour les réseaux
              </button>
            </li>
            <li>
              <button
                className="text-accent hover:underline"
                onClick={() => onNavigate('publishing')}
              >
                → Soumettre une publication au circuit de validation
              </button>
            </li>
            <li>
              <button
                className="text-accent hover:underline"
                onClick={() => onNavigate('calendar')}
              >
                → Programmer dans le calendrier éditorial
              </button>
            </li>
            <li>
              <button
                className="text-accent hover:underline"
                onClick={() => onNavigate('analytics')}
              >
                → Mesurer ce que les publications ont produit
              </button>
            </li>
          </ul>
        </Card>
        <Card>
          <h2 className="mb-4 font-medium">Activité récente</h2>
          {!stats || stats.recentActivity.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">
              Aucune activité pour l'instant.
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {stats.recentActivity.map((log) => (
                <li key={log.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-mono text-xs">{log.action}</span>
                  <span className="text-xs text-text-muted">{formatDate(log.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
