import { useCallback, useState } from 'react';
import { Alert, Button, Card, Empty, formatDate, PageHeader, Stat } from '../components/ui';
import { api } from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';

/** Administration de la plateforme (§17), réservée aux super admins. */
export function AdminPage() {
  const loadOverview = useCallback(() => api.admin.overview(), []);
  const loadUsers = useCallback(() => api.admin.users(), []);
  const loadOrganizations = useCallback(() => api.admin.organizations(), []);
  const loadPlans = useCallback(() => api.admin.plans(), []);
  const loadAudit = useCallback(() => api.admin.audit(), []);

  const overview = useAsyncData(loadOverview);
  const users = useAsyncData(loadUsers);
  const organizations = useAsyncData(loadOrganizations);
  const plans = useAsyncData(loadPlans);
  const audit = useAsyncData(loadAudit);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const reloadAll = () => {
    overview.reload();
    users.reload();
    organizations.reload();
    audit.reload();
  };

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    setError('');
    try {
      await action();
      reloadAll();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Action impossible');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Administration plateforme"
        description="Comptes, organisations, plans et journal d'administration (§17)."
        action={
          <Button variant="ghost" onClick={reloadAll} disabled={Boolean(busy)}>
            Actualiser
          </Button>
        }
      />

      {(error || users.error || organizations.error || audit.error) && (
        <Alert>{error || users.error || organizations.error || audit.error}</Alert>
      )}

      {overview.data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Utilisateurs actifs" value={overview.data.users} />
          <Stat label="Organisations" value={overview.data.organizations} />
          <Stat label="Comptes désactivés" value={overview.data.disabledUsers} />
          <Stat label="Super admins" value={overview.data.superAdmins} />
          <Stat label="Plans configurés" value={overview.data.plans} />
        </div>
      )}

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Utilisateurs</h2>
        {users.data?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-text-muted">
                <tr>
                  <th className="pb-2">Compte</th>
                  <th className="pb-2">Organisations</th>
                  <th className="pb-2">Droits</th>
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.data.map((user) => (
                  <tr key={user.id}>
                    <td className="py-2">
                      <span className="font-medium">{user.name}</span>
                      <span className="block text-xs text-text-muted">{user.email}</span>
                    </td>
                    <td className="py-2 tabular-nums">{user.organizations}</td>
                    <td className="py-2">
                      {user.isSuperAdmin ? 'Admin plateforme' : 'Utilisateur'}
                      {user.disabled && <span className="ml-2 text-danger">Désactivé</span>}
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void run('droits', () =>
                              api.admin.updateUser(user.id, { isSuperAdmin: !user.isSuperAdmin }),
                            )
                          }
                        >
                          {user.isSuperAdmin ? 'Retirer admin' : 'Nommer admin'}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void run('compte', () =>
                              api.admin.updateUser(user.id, { disabled: !user.disabled }),
                            )
                          }
                        >
                          {user.disabled ? 'Réactiver' : 'Désactiver'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Aucun utilisateur.</Empty>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Organisations et plans</h2>
        {organizations.data?.length ? (
          <div className="space-y-3">
            {organizations.data.map((organization) => (
              <div
                key={organization.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <div>
                  <p className="font-medium">{organization.name}</p>
                  <p className="text-xs text-text-muted">
                    {organization.slug} · {organization.members} membre(s) · depuis le{' '}
                    {formatDate(organization.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label={`Plan de ${organization.name}`}
                    value={organization.planKey}
                    disabled={Boolean(busy)}
                    onChange={(event) =>
                      void run('plan', () =>
                        api.admin.setPlan(organization.id, { planKey: event.target.value }),
                      )
                    }
                    className="rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
                  >
                    {plans.data?.map((plan) => (
                      <option key={plan.key} value={plan.key}>
                        {plan.name}
                      </option>
                    ))}
                    {!plans.data?.some((plan) => plan.key === organization.planKey) && (
                      <option value={organization.planKey}>{organization.planKey}</option>
                    )}
                  </select>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty>Aucune organisation.</Empty>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Journal d'administration</h2>
        {audit.data?.length ? (
          <ul className="divide-y divide-border text-sm">
            {audit.data.map((entry) => (
              <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{entry.action}</span>
                  {entry.targetType && (
                    <span className="ml-2 text-xs text-text-muted">
                      {entry.targetType} · {entry.targetId}
                    </span>
                  )}
                </span>
                <span className="text-xs text-text-muted">
                  {entry.actorEmail ?? 'système'} · {formatDate(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Aucune opération administrative journalisée.</Empty>
        )}
      </Card>
    </div>
  );
}
