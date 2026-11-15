import { useEffect, useState, type FormEvent } from 'react';
import type { Brand, SocialAccount, SocialAccountStatus, SocialPlatform } from '@ass/shared';
import { socialPlatformLabels, socialPlatforms } from '@ass/shared';
import { api } from '../lib/api';
import { Alert, Button, Card, Empty, Field, formatDate, PageHeader } from '../components/ui';

const STATUS: Record<SocialAccountStatus, { label: string; tone: string }> = {
  CONNECTED: { label: 'Connecté', tone: 'text-success' },
  EXPIRED: { label: 'Jeton à renouveler', tone: 'text-warning' },
  REVOKED: { label: 'Déconnecté', tone: 'text-text-muted' },
  ERROR: { label: 'Erreur', tone: 'text-danger' },
};

export function SocialAccountsPage() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [platform, setPlatform] = useState<SocialPlatform>('INSTAGRAM');
  const [username, setUsername] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [brandId, setBrandId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const refresh = () => setReload((n) => n + 1);

  useEffect(() => {
    let active = true;
    Promise.all([api.socialAccounts.list(), api.brands.list()])
      .then(([accountList, brandList]) => {
        if (!active) return;
        setAccounts(accountList);
        setBrands(brandList);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Erreur de chargement');
      });
    return () => {
      active = false;
    };
  }, [reload]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.socialAccounts.create({
        platform,
        username: username.trim().replace(/^@/, ''),
        ...(accessToken ? { accessToken } : {}),
        ...(brandId ? { brandId } : {}),
      });
      setUsername('');
      setAccessToken('');
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connexion impossible');
    } finally {
      setBusy(false);
    }
  }

  async function sync(id: string) {
    setError('');
    try {
      await api.socialAccounts.sync(id);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Synchronisation impossible');
    }
  }

  async function disconnect(id: string) {
    setError('');
    try {
      await api.socialAccounts.remove(id);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Déconnexion impossible');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comptes sociaux"
        description="Rattachez les comptes de l'organisation et de ses marques. Les jetons sont chiffrés en AES-256-GCM et ne sont jamais renvoyés par l'API."
      />
      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-medium">Connecter un compte</h2>
          <form onSubmit={connect} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="block text-sm font-medium">Plateforme</span>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as SocialPlatform)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
              >
                {socialPlatforms.map((value) => (
                  <option key={value} value={value}>
                    {socialPlatformLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="Nom d'utilisateur"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ex. nova.studio"
              hint="Sans le @ ; il identifie le compte dans l'organisation."
            />
            <Field
              label="Jeton d'accès (facultatif)"
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="Coller le jeton fourni par la plateforme"
              hint="Chiffré avant stockage. Sans jeton, le compte est marqué « à renouveler »."
            />
            {brands.length > 0 && (
              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">Marque associée</span>
                <select
                  value={brandId}
                  onChange={(e) => setBrandId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
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
            <Button type="submit" disabled={busy || username.trim().length === 0}>
              {busy ? 'Connexion…' : 'Connecter le compte'}
            </Button>
          </form>
        </Card>

        <Card>
          <h2 className="mb-4 font-medium">Comptes de l'organisation</h2>
          {accounts.length === 0 ? (
            <Empty>Aucun compte social connecté pour l'instant.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {accounts.map((account) => (
                <li key={account.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {socialPlatformLabels[account.platform]} · @{account.username}
                      </p>
                      <p className="text-xs text-text-muted">
                        {brands.find((brand) => brand.id === account.brandId)?.name ??
                          'Sans marque'}
                        {account.lastSyncedAt
                          ? ` · synchronisé le ${formatDate(account.lastSyncedAt)}`
                          : ' · jamais synchronisé'}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center gap-2 text-sm font-medium ${STATUS[account.status].tone}`}
                    >
                      <span aria-hidden="true" className="size-2 rounded-full bg-current" />
                      {STATUS[account.status].label}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => void sync(account.id)}>
                      Synchroniser
                    </Button>
                    <Button variant="danger" onClick={() => void disconnect(account.id)}>
                      Déconnecter
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-2 font-medium">OAuth des plateformes</h2>
        <p className="text-sm text-text-muted">
          La connexion manuelle et le stockage chiffré sont opérationnels. Le parcours OAuth
          (autorisation, échange de code, rafraîchissement automatique) sera activé dès que les
          identifiants d'application Meta, TikTok, LinkedIn et Google seront disponibles. La
          synchronisation vérifie pour l'instant le déchiffrement du jeton et horodate l'opération.
        </p>
      </Card>
    </div>
  );
}
