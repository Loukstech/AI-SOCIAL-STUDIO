import { useEffect, useState, type FormEvent } from 'react';
import type { Member, Organization } from '@ass/shared';
import { api } from '../lib/api';
import { Alert, Button, Card, Empty, Field, formatDate, PageHeader } from '../components/ui';

interface Props {
  organizations: Organization[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onRefresh: () => void;
}

export function OrganizationsPage({ organizations, activeId, onSelect, onRefresh }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!activeId) return;
    let active = true;
    api.organizations
      .members(activeId)
      .then((list) => {
        if (active) setMembers(list);
      })
      .catch(() => {
        if (active) setMembers([]);
      });
    return () => {
      active = false;
    };
  }, [activeId]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const created = await api.organizations.create({ name });
      setName('');
      onSelect(created.id);
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Création impossible');
    } finally {
      setBusy(false);
    }
  }

  function select(id: string) {
    onSelect(id);
    setMembers([]);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organisations"
        description="Chaque organisation isole ses marques, ses médias et ses membres."
      />
      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-medium">Vos organisations</h2>
          {organizations.length === 0 ? (
            <Empty>Aucune organisation. Créez la première ci-contre.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {organizations.map((org) => (
                <li key={org.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">{org.name}</p>
                    <p className="text-xs text-text-muted">
                      {org.role} · créée le {formatDate(org.createdAt)}
                    </p>
                  </div>
                  <Button
                    variant={activeId === org.id ? 'primary' : 'ghost'}
                    onClick={() => select(org.id)}
                  >
                    {activeId === org.id ? 'Active' : 'Activer'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 font-medium">Nouvelle organisation</h2>
          <form onSubmit={create} className="space-y-4">
            <Field
              label="Nom"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. Studio Lumière"
            />
            <Button type="submit" disabled={busy || name.trim().length < 2}>
              {busy ? 'Création…' : 'Créer l’organisation'}
            </Button>
          </form>
        </Card>
      </div>

      <Card>
        <h2 className="mb-4 font-medium">Membres de l'organisation active</h2>
        {members.length === 0 ? (
          <Empty>Aucun membre à afficher.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-text-muted">
                <tr>
                  <th className="pb-2 font-medium">Nom</th>
                  <th className="pb-2 font-medium">E-mail</th>
                  <th className="pb-2 font-medium">Rôle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((member) => (
                  <tr key={member.id}>
                    <td className="py-2">{member.name}</td>
                    <td className="py-2 text-text-muted">{member.email}</td>
                    <td className="py-2 font-mono text-xs">{member.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
