import { useEffect, useState } from 'react';
import { organizationRoleLabels, type ClientSummary, type Portfolio } from '@ass/shared';
import { api } from '../lib/api';
import { Alert, Card, Empty, PageHeader, Stat, formatDate } from '../components/ui';

/**
 * Espace client (§14).
 *
 * Ce qu'on appelle « client » ici, c'est une organisation : le produit est
 * multi-tenant, et chaque client de l'agence a son propre espace, ses marques
 * et ses contenus. Cette page est donc le portefeuille — les organisations où
 * l'utilisateur est membre, chacune résumée par ce qui reste à faire.
 *
 * Elle n'affiche que ce que l'API veut bien rendre : aucun compteur n'est
 * calculé côté navigateur, et une organisation sans activité affiche « — »
 * plutôt que « 0 », qui laisserait croire à une mesure.
 */
export function ClientsPage({ onOpen }: { onOpen: (page: string) => void }) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void api.collaboration
      .portfolio()
      .then((result) => {
        if (!active) return;
        setPortfolio(result);
        setError('');
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : 'Chargement impossible');
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Espace client"
          description="Les organisations dont vous êtes membre, avec ce qui attend une décision."
        />
        <Alert>{error}</Alert>
      </div>
    );
  }

  if (!portfolio) {
    return <Empty>Chargement du portefeuille…</Empty>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Espace client"
        description="Les organisations dont vous êtes membre, avec ce qui attend une décision."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Clients suivis" value={portfolio.totals.clients} />
        <Stat label="Validations en attente" value={portfolio.totals.pendingApprovals} />
        <Stat label="Tâches ouvertes" value={portfolio.totals.openTasks} />
        <Stat label="Tâches en retard" value={portfolio.totals.overdueTasks} />
      </div>

      {portfolio.clients.length === 0 ? (
        <Empty>Vous n’êtes membre d’aucune organisation active.</Empty>
      ) : (
        <div className="space-y-3">
          {portfolio.clients.map((client) => (
            <ClientCard key={client.organizationId} client={client} onOpen={onOpen} />
          ))}
        </div>
      )}

      <Card className="space-y-2">
        <h2 className="text-sm font-semibold">Comment lire ces chiffres</h2>
        <p className="text-xs text-text-muted">
          Chaque ligne est une organisation : c’est elle, le « client » de l’agence. Les compteurs
          portent sur son périmètre, et les commentaires internes ne sont jamais comptés pour un
          membre au rôle client. Une organisation sans activité affiche « — » plutôt que « 0 ».
        </p>
      </Card>
    </div>
  );
}

function ClientCard({ client, onOpen }: { client: ClientSummary; onOpen: (page: string) => void }) {
  const overdue = client.overdueTasks > 0;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{client.name}</h2>
          <p className="text-xs text-text-muted">
            {organizationRoleLabels[client.role]} · {client.slug}
          </p>
        </div>
        <p className="text-xs text-text-muted">
          {client.lastActivityAt
            ? `Dernière activité le ${formatDate(client.lastActivityAt)}`
            : 'Aucune activité enregistrée'}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
        <Metric label="Contenus" value={client.publications} />
        <Metric
          label="À valider"
          value={client.pendingApprovals}
          accent={client.pendingApprovals > 0}
        />
        <Metric label="Tâches ouvertes" value={client.openTasks} />
        <Metric label="En retard" value={client.overdueTasks} danger={overdue} />
        <Metric label="Points ouverts" value={client.openComments} />
      </dl>

      <div className="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          onClick={() => onOpen('publishing')}
          className="rounded-lg border border-border px-2.5 py-1.5 text-text-muted transition-colors hover:border-accent hover:text-accent"
        >
          Voir les contenus
        </button>
        <button
          type="button"
          onClick={() => onOpen('calendar')}
          className="rounded-lg border border-border px-2.5 py-1.5 text-text-muted transition-colors hover:border-accent hover:text-accent"
        >
          Calendrier
        </button>
        <button
          type="button"
          onClick={() => onOpen('analytics')}
          className="rounded-lg border border-border px-2.5 py-1.5 text-text-muted transition-colors hover:border-accent hover:text-accent"
        >
          Analytics
        </button>
      </div>
    </Card>
  );
}

function Metric({
  label,
  value,
  accent = false,
  danger = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
  danger?: boolean;
}) {
  const tone =
    danger && value > 0 ? 'text-danger' : accent && value > 0 ? 'text-accent' : 'text-text';
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}
