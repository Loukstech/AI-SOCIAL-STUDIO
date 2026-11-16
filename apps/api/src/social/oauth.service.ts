import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  assessConnection,
  authorizationUrl,
  clientIdParam,
  missingCredentials,
  oauthApps,
  providerSpecs,
  socialAccountStatusSchema,
  socialPlatformSchema,
  type ConnectRequestInput,
  type ConnectResult,
  type ConnectionHealth,
  type SocialAccount,
  type SocialPlatform,
} from '@ass/shared';
import { Db } from '../common/validation.js';
import { ENV, type Env } from '../config/env.js';
import { decryptSecret, encryptSecret } from '../auth/crypto.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { codeChallenge, createState, createVerifier, readState } from './oauth-state.js';
import { extractProfile } from './profile.js';

/**
 * Connexion des comptes sociaux (§9).
 *
 * Le flux OAuth est complet : état signé et chiffré, PKCE quand la plateforme
 * l'exige, échange du code, lecture du profil, stockage chiffré, renouvellement
 * et détection d'erreur.
 *
 * **Ce qui manque n'est pas du code, ce sont des identifiants.** Sans
 * `META_CLIENT_ID` & co, `authorize()` refuse avec la liste exacte des variables
 * à renseigner. Aucune connexion n'est jamais simulée : une connexion affichée
 * comme active doit correspondre à un jeton réel obtenu auprès du fournisseur.
 */

/** Transport injectable : les tests substituent un `fetch` contrôlé. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Jeton d'injection du transport ; absent en production, `fetch` est utilisé. */
export const OAUTH_HTTP = Symbol('OAUTH_HTTP');

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
}

const CALLBACK_PATH = '/api/v1/social-accounts/oauth/callback';

@Injectable()
export class OAuthService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Optional() @Inject(OAUTH_HTTP) private readonly injectedHttp?: FetchLike,
  ) {}

  /** Transport HTTP réel, sauf en test où il est fourni explicitement. */
  private get http(): FetchLike {
    return this.injectedHttp ?? globalThis.fetch.bind(globalThis);
  }

  // --- Autorisation ---

  /** Construit l'URL d'autorisation, ou explique ce qui bloque. */
  async authorize(organizationId: string, input: ConnectRequestInput): Promise<ConnectResult> {
    const platform = socialPlatformSchema.parse(input.platform);
    const spec = providerSpecs[platform];
    const app = oauthApps[spec.app];

    const missing = missingCredentials(spec, this.credentials());
    const redirectUri = this.redirectUri();
    if (!redirectUri) missing.push('API_PUBLIC_URL');
    if (missing.length > 0) {
      throw new ConflictException(
        `Connexion ${spec.label} indisponible : renseignez ${missing.join(', ')}. ` +
          'Aucun identifiant d’application OAuth n’est configuré sur ce déploiement.',
      );
    }

    if (input.socialAccountId) {
      await this.find(organizationId, input.socialAccountId);
    }
    if (input.brandId) await this.assertBrand(organizationId, input.brandId);

    const clientId = this.credentials()[app.clientIdEnv]!;
    const verifier = app.usesPkce ? createVerifier() : undefined;
    const secret = this.secret();

    const { state, expiresAt } = createState(
      {
        organizationId,
        platform,
        socialAccountId: input.socialAccountId,
        brandId: input.brandId,
        verifier,
      },
      secret,
      (plain) => encryptSecret(plain, secret),
    );

    return {
      platform,
      authorizationUrl: authorizationUrl(app, {
        clientId,
        redirectUri: redirectUri!,
        state,
        scopes: spec.scopes,
        ...(verifier ? { codeChallenge: codeChallenge(verifier) } : {}),
      }),
      expiresAt: expiresAt.toISOString(),
      scopes: spec.scopes,
      usesPkce: app.usesPkce,
    };
  }

  /**
   * Retour du fournisseur : valide l'état, échange le code, lit le profil et
   * enregistre la connexion avec des jetons chiffrés.
   */
  async handleCallback(query: Record<string, string | undefined>): Promise<{
    organizationId: string;
    account: SocialAccount;
    platform: SocialPlatform;
  }> {
    if (query.error) {
      throw new BadRequestException(
        `Autorisation refusée par la plateforme : ${query.error_description ?? query.error}`,
      );
    }
    const state = query.state;
    const code = query.code;
    if (!state || !code) {
      throw new BadRequestException('Retour OAuth incomplet : `state` et `code` sont requis');
    }

    const payload = readState(state, this.secret());
    if (!payload) {
      throw new BadRequestException(
        'État OAuth invalide ou expiré : relancez la connexion depuis l’application',
      );
    }

    const platform = socialPlatformSchema.parse(payload.p);
    const spec = providerSpecs[platform];
    const app = oauthApps[spec.app];
    const missing = missingCredentials(spec, this.credentials());
    if (missing.length > 0) {
      throw new ConflictException(`Identifiants OAuth absents : ${missing.join(', ')}`);
    }

    const verifier = payload.v ? decryptSecret(payload.v, this.secret()) : null;
    if (app.usesPkce && !verifier) {
      throw new BadRequestException('Vérificateur PKCE illisible : relancez la connexion');
    }

    const tokens = await this.postForm(app.tokenUrl, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri()!,
      [clientIdParam(app)]: this.credentials()[app.clientIdEnv]!,
      ...(app.requiresSecret ? { client_secret: this.credentials()[app.clientSecretEnv]! } : {}),
      ...(verifier ? { code_verifier: verifier } : {}),
    });

    const accessToken = this.requireToken(tokens, 'access_token');
    const refreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : null;
    const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : null;
    const grantedScopes =
      typeof tokens.scope === 'string' && tokens.scope.trim()
        ? tokens.scope.split(/[\s,]+/).filter(Boolean)
        : spec.scopes;

    const profile = extractProfile(platform, await this.fetchProfile(app, platform, accessToken));

    const account = await this.upsertAccount({
      organizationId: payload.o,
      platform,
      profile,
      accessToken,
      refreshToken,
      expiresIn,
      scopes: grantedScopes,
      brandId: payload.b,
      accountId: payload.a,
    });

    await this.audit(payload.o, null, 'social_account.oauth_connected', account.id, {
      platform,
      username: account.username,
    });

    return { organizationId: payload.o, account: this.toView(account), platform };
  }

  // --- Renouvellement ---

  /** Renouvelle l'autorisation avec le jeton de rafraîchissement. */
  async refresh(
    organizationId: string,
    id: string,
    actorId: string | null = null,
  ): Promise<SocialAccount> {
    const existing = await this.find(organizationId, id);
    const platform = socialPlatformSchema.parse(existing.platform);
    const spec = providerSpecs[platform];
    const app = oauthApps[spec.app];

    if (!app.supportsRefresh) {
      throw new ConflictException(
        `${spec.label} ne délivre pas de jeton de rafraîchissement : relancez la connexion pour renouveler l’autorisation`,
      );
    }
    if (!existing.refreshToken) {
      throw new ConflictException(
        'Aucun jeton de rafraîchissement enregistré : reconnectez le compte',
      );
    }

    const missing = missingCredentials(spec, this.credentials());
    if (missing.length > 0) {
      throw new ConflictException(`Identifiants OAuth absents : ${missing.join(', ')}`);
    }

    const refreshToken = decryptSecret(existing.refreshToken, this.secret());
    if (!refreshToken) {
      throw new BadRequestException('Jeton de rafraîchissement illisible : reconnectez le compte');
    }

    const tokens = await this.postForm(app.tokenUrl, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      [clientIdParam(app)]: this.credentials()[app.clientIdEnv]!,
      ...(app.requiresSecret ? { client_secret: this.credentials()[app.clientSecretEnv]! } : {}),
    });

    const accessToken = this.requireToken(tokens, 'access_token');
    const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : null;
    // Certains fournisseurs renvoient un nouveau refresh token, d'autres non :
    // ne jamais écraser un jeton existant par une absence.
    const nextRefresh =
      typeof tokens.refresh_token === 'string' ? tokens.refresh_token : refreshToken;

    const account = await this.db.client.socialAccount.update({
      where: { id: existing.id },
      data: {
        accessToken: encryptSecret(accessToken, this.secret()),
        refreshToken: encryptSecret(nextRefresh, this.secret()),
        tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
        status: 'CONNECTED',
        lastError: null,
        lastErrorAt: null,
        lastSyncedAt: new Date(),
      },
    });

    await this.audit(organizationId, actorId, 'social_account.refreshed', account.id, { platform });
    return this.toView(account);
  }

  // --- Synchronisation ---

  /**
   * Relit le profil auprès de la plateforme. En cas d'échec, l'erreur est
   * **enregistrée sur le compte** et renvoyée avec lui : l'interface peut alors
   * guider la reconnexion au lieu d'afficher un compte faussement sain.
   */
  async sync(
    organizationId: string,
    id: string,
    actorId: string | null = null,
  ): Promise<SocialAccount> {
    const existing = await this.find(organizationId, id);
    const platform = socialPlatformSchema.parse(existing.platform);
    const spec = providerSpecs[platform];
    const app = oauthApps[spec.app];

    const accessToken = existing.accessToken
      ? decryptSecret(existing.accessToken, this.secret())
      : null;
    if (!accessToken) {
      throw new BadRequestException(
        'Aucun jeton d’accès lisible : reconnectez le compte avant de synchroniser',
      );
    }

    // Sans application OAuth configurée, aucun jeton valide ne peut exister pour
    // ce fournisseur : l'échec est enregistré tout de suite, sans appel réseau
    // qui ne pourrait pas aboutir.
    const missing = missingCredentials(spec, this.credentials());
    if (missing.length > 0) {
      return this.recordFailure(
        organizationId,
        existing.id,
        platform,
        `Synchronisation ${spec.label} impossible : renseignez ${missing.join(', ')}.`,
        actorId,
      );
    }

    try {
      const profile = extractProfile(platform, await this.fetchProfile(app, platform, accessToken));
      const account = await this.db.client.socialAccount.update({
        where: { id: existing.id },
        data: {
          // Le pseudo local n'est volontairement pas réécrit : il fait partie de
          // la clé d'unicité (organisation + plateforme + pseudo) qui rattache
          // les reconnexions. Le nom affiché, lui, suit le fournisseur.
          externalId: profile.externalId,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          lastSyncedAt: new Date(),
          lastError: null,
          lastErrorAt: null,
          status: 'CONNECTED',
        },
      });
      await this.audit(organizationId, actorId, 'social_account.synced', account.id, { platform });
      return this.toView(account);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Échec de synchronisation';
      return this.recordFailure(organizationId, existing.id, platform, message, actorId);
    }
  }

  /** Enregistre l'échec sur le compte et le renvoie : jamais un faux « connecté ». */
  private async recordFailure(
    organizationId: string,
    id: string,
    platform: SocialPlatform,
    message: string,
    actorId: string | null,
  ): Promise<SocialAccount> {
    const account = await this.db.client.socialAccount.update({
      where: { id },
      data: {
        status: 'ERROR',
        lastError: message.slice(0, 500),
        lastErrorAt: new Date(),
        lastSyncedAt: new Date(),
      },
    });
    await this.audit(organizationId, actorId, 'social_account.sync_failed', account.id, {
      platform,
      message: message.slice(0, 200),
    });
    // §15 « connexion sociale expirée » : les responsables sont prévenus, avec
    // le motif réel. La clé de déduplication évite qu'une synchronisation
    // répétée en échec remplisse la boîte de réception.
    await this.notifications.notifySocialExpired(organizationId, account.id, account.lastError, {
      actorId,
    });
    return this.toView(account);
  }

  // --- Santé des connexions ---

  /** Vue d'ensemble : état, expiration, permissions et identifiants manquants. */
  async health(organizationId: string): Promise<ConnectionHealth[]> {
    const rows = await this.db.client.socialAccount.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: [{ platform: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => {
      const platform = socialPlatformSchema.parse(row.platform);
      const spec = providerSpecs[platform];
      const assessment = assessConnection({
        status: row.status,
        hasAccessToken: Boolean(row.accessToken),
        tokenExpiresAt: row.tokenExpiresAt,
        lastErrorAt: row.lastErrorAt,
      });
      return {
        id: row.id,
        platform,
        username: row.username,
        state: assessment.state,
        guidance: assessment.guidance,
        hoursLeft: assessment.hoursLeft,
        scopes: row.scopes,
        tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
        lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
        lastError: row.lastError,
        lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
        hasAccessToken: Boolean(row.accessToken),
        hasRefreshToken: Boolean(row.refreshToken),
        supportsRefresh: oauthApps[spec.app].supportsRefresh,
        missingCredentials: missingCredentials(spec, this.credentials()),
      };
    });
  }

  // --- Aides ---

  private async upsertAccount(input: {
    organizationId: string;
    platform: SocialPlatform;
    profile: ReturnType<typeof extractProfile>;
    accessToken: string;
    refreshToken: string | null;
    expiresIn: number | null;
    scopes: string[];
    brandId?: string | undefined;
    accountId?: string | undefined;
  }) {
    const secret = this.secret();
    const data = {
      accessToken: encryptSecret(input.accessToken, secret),
      ...(input.refreshToken ? { refreshToken: encryptSecret(input.refreshToken, secret) } : {}),
      tokenExpiresAt: input.expiresIn ? new Date(Date.now() + input.expiresIn * 1000) : null,
      scopes: input.scopes,
      externalId: input.profile.externalId,
      displayName: input.profile.displayName,
      avatarUrl: input.profile.avatarUrl,
      status: 'CONNECTED' as const,
      lastError: null,
      lastErrorAt: null,
      lastSyncedAt: new Date(),
    };

    // Réautorisation d'un compte connu : on met à jour la même ligne.
    if (input.accountId) {
      const existing = await this.db.client.socialAccount.findFirst({
        where: { id: input.accountId, organizationId: input.organizationId, deletedAt: null },
      });
      if (existing) {
        return this.db.client.socialAccount.update({ where: { id: existing.id }, data });
      }
    }

    // Sinon on rattache à la connexion existante (même organisation + réseau +
    // identifiant) ou on en crée une nouvelle.
    const byIdentity = await this.db.client.socialAccount.findFirst({
      where: {
        organizationId: input.organizationId,
        platform: input.platform,
        username: input.profile.username,
        deletedAt: null,
      },
    });
    if (byIdentity) {
      return this.db.client.socialAccount.update({ where: { id: byIdentity.id }, data });
    }

    return this.db.client.socialAccount.create({
      data: {
        organizationId: input.organizationId,
        platform: input.platform,
        username: input.profile.username,
        ...(input.brandId ? { brandId: input.brandId } : {}),
        ...data,
      },
    });
  }

  private async postForm(url: string, body: Record<string, string>): Promise<TokenResponse> {
    const response = await this.http(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(this.env.OAUTH_HTTP_TIMEOUT_MS),
    });

    const text = await response.text();
    let parsed: TokenResponse;
    try {
      parsed = text ? (JSON.parse(text) as TokenResponse) : {};
    } catch {
      // Certains fournisseurs répondent en formulaire : on retombe sur un parse
      // simple plutôt que d'échouer sur un format inattendu.
      parsed = Object.fromEntries(new URLSearchParams(text));
    }

    if (!response.ok || parsed.error) {
      const detail =
        (typeof parsed.error_description === 'string' && parsed.error_description) ||
        (typeof parsed.error === 'string' && parsed.error) ||
        `HTTP ${response.status}`;
      throw new BadGatewayException(`Échange de jeton refusé : ${detail}`);
    }
    return parsed;
  }

  private async fetchProfile(
    app: (typeof oauthApps)[keyof typeof oauthApps],
    platform: SocialPlatform,
    accessToken: string,
  ): Promise<unknown> {
    // Meta et Threads attendent une liste de champs explicite.
    const url = new URL(app.infoUrl);
    if (platform === 'FACEBOOK' || platform === 'INSTAGRAM') {
      url.searchParams.set('fields', 'id,name,username,picture');
    }
    if (platform === 'THREADS') {
      url.searchParams.set('fields', 'id,username,name,threads_profile_picture_url');
    }
    if (platform === 'TIKTOK') {
      url.searchParams.set('fields', 'open_id,union_id,display_name,avatar_url');
    }

    const response = await this.http(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.env.OAUTH_HTTP_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new BadGatewayException(
        `Profil ${platform} inaccessible (HTTP ${response.status}) : l’autorisation est peut-être révoquée`,
      );
    }
    return response.json();
  }

  private requireToken(tokens: TokenResponse, key: 'access_token'): string {
    const value = tokens[key];
    if (typeof value !== 'string' || !value) {
      throw new BadGatewayException(`Réponse du fournisseur sans ${key}`);
    }
    return value;
  }

  private credentials(): Record<string, string | undefined> {
    return this.env as unknown as Record<string, string | undefined>;
  }

  /** URL de retour OAuth : surcharge explicite, sinon dérivée de l'API publique. */
  private redirectUri(): string | null {
    if (this.env.OAUTH_REDIRECT_URL) return this.env.OAUTH_REDIRECT_URL;
    if (!this.env.API_PUBLIC_URL) return null;
    return `${this.env.API_PUBLIC_URL.replace(/\/$/, '')}${CALLBACK_PATH}`;
  }

  private secret(): string {
    if (!this.env.AUTH_SECRET) {
      throw new BadRequestException('AUTH_SECRET non configuré : chiffrement impossible');
    }
    return this.env.AUTH_SECRET;
  }

  private async find(organizationId: string, id: string) {
    const account = await this.db.client.socialAccount.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!account) throw new NotFoundException('Compte social introuvable');
    return account;
  }

  private async assertBrand(organizationId: string, brandId: string): Promise<void> {
    const brand = await this.db.client.brand.findFirst({
      where: { id: brandId, organizationId, deletedAt: null },
    });
    if (!brand) throw new NotFoundException('Marque introuvable');
  }

  private async audit(
    organizationId: string,
    actorId: string | null,
    action: string,
    targetId: string,
    metadata: Record<string, string | number | boolean> | null,
  ): Promise<void> {
    await this.db.client.auditLog.create({
      data: {
        organizationId,
        actorId,
        action,
        targetType: 'social_account',
        targetId,
        ...(metadata ? { metadata } : {}),
      },
    });
  }

  /** Vue publique : aucun jeton, seulement leur présence. */
  private toView(row: {
    id: string;
    organizationId: string;
    brandId: string | null;
    platform: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    status: string;
    scopes: string[];
    tokenExpiresAt: Date | null;
    lastSyncedAt: Date | null;
    lastError: string | null;
    lastErrorAt: Date | null;
    accessToken: string | null;
    refreshToken: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): SocialAccount {
    return {
      id: row.id,
      organizationId: row.organizationId,
      brandId: row.brandId,
      platform: socialPlatformSchema.parse(row.platform),
      username: row.username,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      status: socialAccountStatusSchema.parse(row.status),
      scopes: row.scopes,
      tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      lastError: row.lastError,
      lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
      hasAccessToken: Boolean(row.accessToken),
      hasRefreshToken: Boolean(row.refreshToken),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
