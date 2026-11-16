import { useCallback, useEffect, useState } from 'react';
import {
  badgeLabel,
  socialPlatformLabels,
  type Organization,
  type OrganizationRole,
  type SocialPlatform,
  type User,
} from '@ass/shared';
import { api, session, setActiveOrganization } from './lib/api';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AuthPage } from './pages/AuthPage';
import { BrandsPage } from './pages/BrandsPage';
import { CalendarPage } from './pages/CalendarPage';
import { ClientsPage } from './pages/ClientsPage';
import { ContentStudioPage } from './pages/ContentStudioPage';
import { DashboardPage } from './pages/DashboardPage';
import { ImageStudioPage } from './pages/ImageStudioPage';
import { MediaPage } from './pages/MediaPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { PublishingPage } from './pages/PublishingPage';
import { SocialAccountsPage } from './pages/SocialAccountsPage';
import { SystemPage } from './pages/SystemPage';
import { VideoStudioPage } from './pages/VideoStudioPage';

type Page =
  | 'dashboard'
  | 'organizations'
  | 'brands'
  | 'media'
  | 'social'
  | 'video'
  | 'content'
  | 'image'
  | 'publishing'
  | 'calendar'
  | 'analytics'
  | 'notifications'
  | 'clients'
  | 'system';

const navigation: { id: Page; label: string }[] = [
  { id: 'dashboard', label: 'Tableau de bord' },
  { id: 'organizations', label: 'Organisations' },
  { id: 'brands', label: 'Marques et Brand Kit' },
  { id: 'media', label: 'Médiathèque' },
  { id: 'social', label: 'Comptes sociaux' },
  { id: 'video', label: 'AI Video Studio' },
  { id: 'content', label: 'AI Content Studio' },
  { id: 'image', label: 'AI Image Studio' },
  { id: 'publishing', label: 'Centre de publication' },
  { id: 'calendar', label: 'Calendrier éditorial' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'clients', label: 'Espace client' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'system', label: 'État du système' },
];

/**
 * Résultat d'un retour OAuth, lu depuis l'URL.
 *
 * L'API redirige ici après l'autorisation du fournisseur : `connected` porte la
 * plateforme, `error` le motif du refus. Aucun jeton ne transite par l'URL.
 */
function readOAuthReturn(): { page: Page; notice: string } | null {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get('connected');
  const failure = params.get('error');
  if (!connected && !failure) return null;
  if (connected) {
    const label = socialPlatformLabels[connected as SocialPlatform] ?? connected;
    return { page: 'social', notice: `Connexion ${label} établie.` };
  }
  return { page: 'social', notice: `Connexion interrompue : ${failure}` };
}

export function App() {
  // Retour OAuth : l'API redirige ici avec `connected` ou `error`. Lu une seule
  // fois au montage, avant tout état, pour ne rien poser dans un effet.
  const [oauthReturn] = useState(readOAuthReturn);
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(Boolean(session.token));
  const [page, setPage] = useState<Page>(() => oauthReturn?.page ?? 'dashboard');
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activeOrg, setActiveOrg] = useState<string | null>(session.organizationId);
  const [notice, setNotice] = useState(oauthReturn?.notice ?? '');
  const [unread, setUnread] = useState(0);

  /**
   * Rôle réel dans l'organisation active, tel que l'API le renvoie déjà dans la
   * liste des organisations. Il sert à ne pas proposer une action que le
   * serveur refusera — la décision d'autorisation, elle, reste côté API.
   */
  const activeRole: OrganizationRole =
    organizations.find((organization) => organization.id === activeOrg)?.role ?? 'VIEWER';

  /**
   * Compteur de notifications non lues.
   *
   * Rafraîchi à chaque changement de page et toutes les 45 s : assez pour
   * qu'une pastille ne mente pas longtemps, assez peu pour ne pas marteler
   * l'API. Un échec remet la pastille à zéro plutôt que d'afficher un chiffre
   * périmé.
   */
  useEffect(() => {
    if (!user || !activeOrg) return;
    let active = true;
    const load = () => {
      api.notifications
        .unread()
        .then((count) => {
          if (active) setUnread(count.unread);
        })
        .catch(() => {
          if (active) setUnread(0);
        });
    };
    load();
    const timer = setInterval(load, 45_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user, activeOrg, page]);

  const refreshOrganizations = useCallback(async () => {
    try {
      const list = await api.organizations.list();
      setOrganizations(list);
      const current = session.organizationId;
      if (!current || !list.some((org) => org.id === current)) {
        const next = list[0]?.id ?? null;
        setActiveOrganization(next);
        setActiveOrg(next);
      } else {
        setActiveOrg(current);
      }
      return list;
    } catch {
      setOrganizations([]);
      return [];
    }
  }, []);

  useEffect(() => {
    // `checking` est initialisé à Boolean(session.token) : sans jeton, aucun état à corriger ici.
    if (!session.token) return;
    let active = true;
    api
      .me()
      .then(async (me) => {
        if (!active) return;
        setUser(me);
        await refreshOrganizations();
      })
      .catch(() => {
        session.clear();
        if (active) setUser(null);
      })
      .finally(() => active && setChecking(false));
    return () => {
      active = false;
    };
  }, [refreshOrganizations]);

  // Lien d'invitation : ?invitation=<jeton>. Accepté une fois la session ouverte.
  useEffect(() => {
    if (!user) return;
    const token = new URLSearchParams(window.location.search).get('invitation');
    if (!token) return;
    let active = true;
    api.invitations
      .accept(token)
      .then(async (accepted) => {
        if (!active) return;
        window.history.replaceState({}, '', window.location.pathname);
        setNotice(
          `Invitation acceptée : vous êtes ${accepted.role} de « ${accepted.organizationName} ».`,
        );
        await refreshOrganizations();
        setActiveOrganization(accepted.organizationId);
        setActiveOrg(accepted.organizationId);
        setPage('dashboard');
      })
      .catch((cause: unknown) => {
        if (active) {
          setNotice(cause instanceof Error ? cause.message : 'Invitation invalide');
        }
      });
    return () => {
      active = false;
    };
  }, [user, refreshOrganizations]);

  // Le résultat OAuth a été lu au montage : on nettoie l'URL pour qu'un
  // rechargement ne rejoue pas le message.
  useEffect(() => {
    if (!oauthReturn) return;
    window.history.replaceState({}, '', window.location.pathname);
  }, [oauthReturn]);

  const onAuthenticated = useCallback(async () => {
    const me = await api.me().catch(() => null);
    setUser(me);
    await refreshOrganizations();
    setPage('dashboard');
  }, [refreshOrganizations]);

  function selectOrganization(id: string | null) {
    setActiveOrganization(id);
    setActiveOrg(id);
  }

  async function signOut() {
    await api.logout().catch(() => undefined);
    session.clear();
    setUser(null);
    setOrganizations([]);
    setActiveOrg(null);
  }

  if (checking) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-sm text-text-muted">
        Vérification de la session…
      </main>
    );
  }

  if (!user) return <AuthPage onAuthenticated={() => void onAuthenticated()} />;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="border-b border-border bg-surface lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col gap-6 p-5">
          <div>
            <p className="text-xs font-medium text-accent">Phase 12 · Collaboration</p>
            <h1 className="mt-1 text-lg font-semibold tracking-tight">AI Social Studio</h1>
          </div>

          <nav className="flex flex-wrap gap-1 lg:flex-col">
            {navigation.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPage(item.id)}
                className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  page === item.id
                    ? 'bg-accent/12 font-medium text-accent'
                    : 'text-text-muted hover:bg-bg hover:text-text'
                }`}
              >
                <span>{item.label}</span>
                {item.id === 'notifications' && badgeLabel(unread) && (
                  <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-bg tabular-nums">
                    {badgeLabel(unread)}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="mt-auto space-y-3 border-t border-border pt-4 text-sm">
            {organizations.length > 0 && (
              <label className="block space-y-1">
                <span className="block text-xs text-text-muted">Organisation active</span>
                <select
                  value={activeOrg ?? ''}
                  onChange={(e) => selectOrganization(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
                >
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-text-muted" title={user.email}>
                {user.name}
              </span>
              <button
                type="button"
                onClick={() => void signOut()}
                className="text-xs text-text-muted underline-offset-2 hover:text-accent hover:underline"
              >
                Déconnexion
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main className="px-4 py-8 lg:px-10" key={`${page}:${activeOrg ?? ''}`}>
        <div className="mx-auto max-w-5xl">
          {notice && (
            <p
              role="status"
              className="mb-4 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent"
            >
              {notice}
            </p>
          )}
          {page === 'dashboard' && <DashboardPage onNavigate={(p) => setPage(p as Page)} />}
          {page === 'organizations' && (
            <OrganizationsPage
              organizations={organizations}
              activeId={activeOrg}
              onSelect={selectOrganization}
              onRefresh={() => void refreshOrganizations()}
            />
          )}
          {page === 'brands' && <BrandsPage />}
          {page === 'media' && <MediaPage />}
          {page === 'social' && <SocialAccountsPage />}
          {page === 'video' && <VideoStudioPage />}
          {page === 'content' && <ContentStudioPage />}
          {page === 'image' && <ImageStudioPage />}
          {page === 'publishing' && <PublishingPage role={activeRole} userId={user.id} />}
          {page === 'calendar' && <CalendarPage />}
          {page === 'analytics' && <AnalyticsPage />}
          {page === 'clients' && <ClientsPage onOpen={(target) => setPage(target as Page)} />}
          {page === 'notifications' && (
            <NotificationsPage onNavigate={(target) => setPage(target as Page)} />
          )}
          {page === 'system' && <SystemPage />}
        </div>
      </main>
    </div>
  );
}
