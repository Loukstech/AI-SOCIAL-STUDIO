import { useEffect, useState, type FormEvent } from 'react';
import type {
  Brand,
  ConnectionHealth,
  ConnectionState,
  PublishingReadiness,
  SocialAccount,
  SocialAccountStatus,
  SocialPlatform,
} from '@ass/shared';
import { postTypeLabels, socialPlatformLabels, socialPlatforms } from '@ass/shared';
import { api } from '../lib/api';
import { Alert, Button, Card, Empty, Field, formatDate, PageHeader } from '../components/ui';

const STATUS: Record<SocialAccountStatus, { label: string; tone: string }> = {
  CONNECTED: { label: 'Connecté', tone: 'text-success' },
  EXPIRED: { label: 'Jeton à renouveler', tone: 'text-warning' },
  REVOKED: { label: 'Déconnecté', tone: 'text-text-muted' },
  ERROR: { label: 'Erreur', tone: 'text-danger' },
};

const STATE: Record<ConnectionState, { label: string; tone: string }> = {
  OK: { label: 'Opérationnelle', tone: 'text-success' },
  EXPIRING: { label: 'Expire bientôt', tone: 'text-warning' },
  EXPIRED: { label: 'Expirée', tone: 'text-danger' },
  NO_TOKEN: { label: 'Sans jeton', tone: 'text-warning' },
  ERROR: { label: 'En erreur', tone: 'text-danger' },
  REVOKED: { label: 'Déconnectée', tone: 'text-text-muted' },
};

const FALLBACK: Record<string, string> = {
  EXPORT: 'repli par export',
  MANUAL: 'repli manuel',
  DRAFT: 'brouillon',
};

/** « expire dans 12,4 h », « expiré depuis 3 j » — jamais une date brute. */
function expiry(hours: number | null): string | null {
  if (hours === null) return null;
  const absolute = Math.abs(hours);
  const value =
    absolute >= 48
      ? `${Math.round(absolute / 24)} j`
      : `${absolute.toFixed(1).replace('.', ',')} h`;
  return hours <= 0 ? `expiré depuis ${value}` : `expire dans ${value}`;
}

export function SocialAccountsPage() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [health, setHealth] = useState<ConnectionHealth[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [readiness, setReadiness] = useState<PublishingReadiness | null>(null);
  const [platform, setPlatform] = useState<SocialPlatform>('INSTAGRAM');
  const [brandId, setBrandId] = useState('');
  const [username, setUsername] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const refresh = () => setReload((n) => n + 1);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.socialAccounts.list(),
      api.socialAccounts.health(),
      api.brands.list(),
      api.publishing.readiness(),
    ])
      .then(([accountList, healthList, brandList, ready]) => {
        if (!active) return;
        setAccounts(accountList);
        setHealth(healthList);
        setBrands(brandList);
        setReadiness(ready);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Erreur de chargement');
      });
    return () => {
      active = false;
    };
  }, [reload]);

  /** Lance une action en gardant son identifiant pour l'indicateur d'attente. */
  async function run(key: string, action: () => Promise<unknown>, failure: string) {
    setError('');
    setBusy(key);
    try {
      await action();
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Ouvre une connexion : l'API renvoie l'URL d'autorisation du fournisseur.
   * Quand les identifiants d'application manquent, elle répond 409 avec la
   * liste des variables à renseigner — l'erreur est affichée telle quelle.
   */
  async function authorize(target?: { socialAccountId: string; platform: SocialPlatform }) {
    setError('');
    setBusy(target ? `reconnect:${target.socialAccountId}` : 'connect');
    try {
      const result = await api.socialAccounts.connect({
        platform: target?.platform ?? platform,
        ...(target ? { socialAccountId: target.socialAccountId } : {}),
        ...(!target && brandId ? { brandId } : {}),
      });
      window.location.assign(result.authorizationUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connexion impossible');
      setBusy(null);
    }
  }

  async function createManual(event: FormEvent) {
    event.preventDefault();
    await run(
      'manual',
      () =>
        api.socialAccounts
          .create({
            platform,
            username: username.trim().replace(/^@/, ''),
            ...(accessToken ? { accessToken } : {}),
            ...(brandId ? { brandId } : {}),
          })
          .then(() => {
            setUsername('');
            setAccessToken('');
          }),
      'Connexion impossible',
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comptes sociaux"
        description="Cycle de vie des connexions : autorisation OAuth, renouvellement, synchronisation et détection d'erreur. Les jetons sont chiffrés en AES-256-GCM et ne sortent jamais de l'API."
      />
      {error && <Alert>{error}</Alert>}

      <Card>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-medium">Ouvrir une connexion</h2>
          <p className="text-xs text-text-muted">
            Redirection vers la plateforme, retour automatique ici.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
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
          <div className="flex items-end">
            <Button
              type="button"
              disabled={busy !== null}
              onClick={() => void authorize()}
              className="w-full"
            >
              {busy === 'connect'
                ? 'Ouverture…'
                : `Autoriser sur ${socialPlatformLabels[platform]}`}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 font-medium">Connexions de l'organisation</h2>
        {accounts.length === 0 ? (
          <Empty>Aucun compte social connecté pour l'instant.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {accounts.map((account) => {
              const status = health.find((row) => row.id === account.id);
              const state = status ? STATE[status.state] : null;
              const left = expiry(status?.hoursLeft ?? null);
              return (
                <li key={account.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <p className="font-medium">
                        {socialPlatformLabels[account.platform]} · @{account.username}
                      </p>
                      <p className="text-xs text-text-muted">
                        {brands.find((brand) => brand.id === account.brandId)?.name ??
                          'Sans marque'}
                        {account.lastSyncedAt
                          ? ` · synchronisé le ${formatDate(account.lastSyncedAt)}`
                          : ' · jamais synchronisé'}
                        {left ? ` · ${left}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <span
                        className={`inline-flex items-center gap-2 text-sm font-medium ${state?.tone ?? STATUS[account.status].tone}`}
                      >
                        <span aria-hidden="true" className="size-2 rounded-full bg-current" />
                        {state?.label ?? STATUS[account.status].label}
                      </span>
                      {status && status.scopes.length > 0 && (
                        <p className="mt-1 text-xs text-text-muted">
                          {status.scopes.slice(0, 3).join(' · ')}
                          {status.scopes.length > 3 ? ` +${status.scopes.length - 3}` : ''}
                        </p>
                      )}
                    </div>
                  </div>

                  {status?.guidance && (
                    <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                      {status.guidance}
                    </p>
                  )}
                  {status?.lastError && (
                    <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                      Dernière erreur ({status.lastErrorAt ? formatDate(status.lastErrorAt) : '—'})
                      : {status.lastError}
                    </p>
                  )}
                  {status && status.missingCredentials.length > 0 && (
                    <p className="text-xs text-text-muted">
                      Identifiants d'application absents :{' '}
                      <span className="font-mono">{status.missingCredentials.join(', ')}</span>
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(
                          `sync:${account.id}`,
                          () => api.socialAccounts.sync(account.id),
                          'Synchronisation impossible',
                        )
                      }
                    >
                      {busy === `sync:${account.id}` ? 'Synchronisation…' : 'Synchroniser'}
                    </Button>
                    {status?.supportsRefresh && status.hasRefreshToken && (
                      <Button
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(
                            `refresh:${account.id}`,
                            () => api.socialAccounts.refresh(account.id),
                            'Renouvellement impossible',
                          )
                        }
                      >
                        {busy === `refresh:${account.id}` ? 'Renouvellement…' : 'Renouveler'}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() =>
                        void authorize({
                          socialAccountId: account.id,
                          platform: account.platform,
                        })
                      }
                    >
                      {busy === `reconnect:${account.id}` ? 'Ouverture…' : 'Reconnecter'}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(
                          `remove:${account.id}`,
                          () => api.socialAccounts.remove(account.id),
                          'Déconnexion impossible',
                        )
                      }
                    >
                      Déconnecter
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {readiness && (
        <Card>
          <h2 className="mb-2 font-medium">Publication par plateforme</h2>
          <p className="mb-4 text-sm text-text-muted">{readiness.message}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Plateforme</th>
                  <th className="py-2 pr-3 font-medium">Formats</th>
                  <th className="py-2 pr-3 font-medium">Envoi</th>
                  <th className="py-2 font-medium">Ce qui bloque</th>
                </tr>
              </thead>
              <tbody>
                {readiness.platforms.map((row) => (
                  <tr key={row.platform} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3">{row.label}</td>
                    <td className="py-2 pr-3 text-text-muted">
                      {row.supports.map((type) => postTypeLabels[type]).join(', ')}
                    </td>
                    <td className="py-2 pr-3">
                      <span className={row.canPublish ? 'text-success' : 'text-text-muted'}>
                        {row.canPublish ? 'Possible' : 'Indisponible'}
                      </span>
                      <span className="block text-xs text-text-muted">
                        {FALLBACK[row.fallback] ?? row.fallback}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-text-muted">
                      {row.missingCredentials.length > 0 ? (
                        <span className="font-mono">{row.missingCredentials.join(', ')}</span>
                      ) : (
                        row.note
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Connexion manuelle avec un jeton
          </summary>
          <p className="mt-2 text-xs text-text-muted">
            Réservé aux cas où le parcours OAuth n'est pas encore autorisé pour votre application.
            Le jeton est chiffré avant stockage et n'est jamais renvoyé par l'API.
          </p>
          <form onSubmit={createManual} className="mt-4 space-y-4">
            <p className="text-xs text-text-muted">
              Plateforme retenue : <strong>{socialPlatformLabels[platform]}</strong> (choisie
              ci-dessus).
            </p>
            <Field
              label="Nom d'utilisateur"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ex. nova.studio"
              hint="Sans le @ ; il identifie le compte dans l'organisation."
            />
            <Field
              label="Jeton d'accès"
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="Coller le jeton fourni par la plateforme"
              hint="Sans jeton, le compte est marqué « à renouveler »."
            />
            <Button type="submit" disabled={busy !== null || username.trim().length === 0}>
              {busy === 'manual' ? 'Enregistrement…' : 'Enregistrer le compte'}
            </Button>
          </form>
        </details>
      </Card>
    </div>
  );
}
