import { useEffect, useState, type FormEvent } from 'react';
import type { Invitation, Member, Organization, OrganizationRole } from '@ass/shared';
import { api } from '../lib/api';
import { Alert, Button, Card, Empty, Field, formatDate, PageHeader } from '../components/ui';

interface Props {
  organizations: Organization[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onRefresh: () => void;
}

const invitableRoles: OrganizationRole[] = ['ADMIN', 'EDITOR', 'VIEWER'];

function invitationState(invitation: Invitation): { label: string; tone: string } {
  if (invitation.acceptedAt) return { label: 'Acceptée', tone: 'text-success' };
  if (invitation.revokedAt) return { label: 'Révoquée', tone: 'text-text-muted' };
  if (!invitation.isPending) return { label: 'Expirée', tone: 'text-warning' };
  return { label: 'En attente', tone: 'text-accent' };
}

export function OrganizationsPage({ organizations, activeId, onSelect, onRefresh }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [name, setName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrganizationRole>('EDITOR');
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [invitesReload, setInvitesReload] = useState(0);

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

  useEffect(() => {
    if (!activeId) return;
    let active = true;
    api.invitations
      .list(activeId)
      .then((list) => {
        if (active) setInvitations(list);
      })
      .catch(() => {
        if (active) setInvitations([]);
      });
    return () => {
      active = false;
    };
  }, [activeId, invitesReload]);

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

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!activeId) return;
    setError('');
    setCopied(false);
    setInviteBusy(true);
    try {
      const created = await api.invitations.create(activeId, {
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteLink(created.acceptUrl);
      setInviteEmail('');
      setInvitesReload((n) => n + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invitation impossible');
    } finally {
      setInviteBusy(false);
    }
  }

  async function revoke(invitationId: string) {
    if (!activeId) return;
    setError('');
    try {
      await api.invitations.revoke(activeId, invitationId);
      setInvitesReload((n) => n + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Révocation impossible');
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
    } catch {
      setError('Copie impossible : sélectionnez le lien manuellement.');
    }
  }

  function select(id: string) {
    onSelect(id);
    setMembers([]);
    setInvitations([]);
    setInviteLink('');
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organisations"
        description="Chaque organisation isole ses marques, ses médias, ses comptes sociaux et ses membres."
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

      <Card>
        <h2 className="mb-1 font-medium">Inviter un membre</h2>
        <p className="mb-4 text-sm text-text-muted">
          L'envoi d'e-mail automatique arrivera avec le fournisseur transactionnel : le lien
          d'invitation s'affiche ici et peut être transmis tel quel. L'invité doit créer son compte
          ou se connecter avec l'adresse invitée.
        </p>

        {!activeId ? (
          <Empty>Sélectionnez une organisation active pour inviter.</Empty>
        ) : (
          <>
            <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[1fr_140px_auto]">
              <Field
                label="Adresse e-mail"
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="personne@exemple.com"
              />
              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">Rôle</span>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as OrganizationRole)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  {invitableRoles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end">
                <Button type="submit" disabled={inviteBusy || inviteEmail.trim().length === 0}>
                  {inviteBusy ? 'Envoi…' : 'Inviter'}
                </Button>
              </div>
            </form>

            {inviteLink && (
              <div className="mt-4 rounded-lg border border-accent/40 bg-accent/10 p-3">
                <p className="text-xs font-medium text-accent">Lien d'invitation à transmettre</p>
                <p className="mt-1 break-all font-mono text-xs">{inviteLink}</p>
                <Button variant="ghost" className="mt-2" onClick={() => void copyLink()}>
                  {copied ? 'Lien copié' : 'Copier le lien'}
                </Button>
              </div>
            )}

            <h3 className="mt-6 mb-2 text-sm font-medium">Invitations</h3>
            {invitations.length === 0 ? (
              <Empty>Aucune invitation pour cette organisation.</Empty>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {invitations.map((invitation) => {
                  const state = invitationState(invitation);
                  return (
                    <li
                      key={invitation.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-2"
                    >
                      <div>
                        <p className="font-medium">{invitation.email}</p>
                        <p className="text-xs text-text-muted">
                          {invitation.role} · expire le {formatDate(invitation.expiresAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-medium ${state.tone}`}>{state.label}</span>
                        {invitation.isPending && (
                          <Button variant="ghost" onClick={() => void revoke(invitation.id)}>
                            Révoquer
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
