import { describe, expect, it } from 'vitest';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { oauthApps } from '@ass/shared';
import type { Db } from '../common/validation.js';
import { decryptSecret, encryptSecret } from '../auth/crypto.js';
import { parseEnv, type Env } from '../config/env.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { OAuthService, type FetchLike } from './oauth.service.js';
import { createState } from './oauth-state.js';

const SECRET = 'secret-de-test-suffisamment-long';

/**
 * Les notifications sont une dépendance **requise** en production : le
 * constructeur les exige pour qu'un oubli de câblage se voie tout de suite.
 * Ces tests-ci n'en exercent aucune, un double inerte suffit et préserve la
 * signature réelle.
 */
const noNotifications = {
  notifyPublication: async () => {},
  notifySocialExpired: async () => {},
} as unknown as NotificationsService;

function serviceOf(db: Db, env: Env, transport?: FetchLike): OAuthService {
  return new OAuthService(db, env, noNotifications, transport);
}

interface AccountRow {
  id: string;
  organizationId: string;
  brandId: string | null;
  platform: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  externalId: string | null;
  status: string;
  scopes: string[];
  tokenExpiresAt: Date | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  accessToken: string | null;
  refreshToken: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Base en mémoire : suffisante pour vérifier le comportement, sans réseau ni Neon. */
function makeDb(seed: Partial<AccountRow>[] = [], brandIds: string[] = []) {
  const accounts: AccountRow[] = seed.map((row, index) => ({
    id: `acc-${index + 1}`,
    organizationId: 'org-1',
    brandId: null,
    platform: 'LINKEDIN',
    username: 'nova',
    displayName: null,
    avatarUrl: null,
    externalId: null,
    status: 'CONNECTED',
    scopes: [],
    tokenExpiresAt: null,
    lastSyncedAt: null,
    lastError: null,
    lastErrorAt: null,
    accessToken: null,
    refreshToken: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...row,
  }));
  const audits: { action: string; targetId: string | null }[] = [];

  const matches = (row: AccountRow, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'deletedAt') {
        return value === null ? row.deletedAt === null : row.deletedAt === value;
      }
      return (row as unknown as Record<string, unknown>)[key] === value;
    });

  const client = {
    socialAccount: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        accounts.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        accounts.filter((row) => matches(row, where)),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: AccountRow = {
          id: `acc-${accounts.length + 1}`,
          organizationId: 'org-1',
          brandId: null,
          platform: 'LINKEDIN',
          username: 'nova',
          displayName: null,
          avatarUrl: null,
          externalId: null,
          status: 'CONNECTED',
          scopes: [],
          tokenExpiresAt: null,
          lastSyncedAt: null,
          lastError: null,
          lastErrorAt: null,
          accessToken: null,
          refreshToken: null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(data as Partial<AccountRow>),
        };
        accounts.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = accounts.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error(`ligne ${where.id} absente`);
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    brand: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        brandIds.includes(where.id) ? { id: where.id } : null,
    },
    auditLog: {
      create: async ({ data }: { data: { action: string; targetId: string | null } }) => {
        audits.push({ action: data.action, targetId: data.targetId });
        return data;
      },
    },
  };

  return { db: { client } as unknown as Db, accounts, audits };
}

function makeEnv(extra: Record<string, string> = {}) {
  return parseEnv({
    NODE_ENV: 'test',
    AUTH_SECRET: SECRET,
    API_PUBLIC_URL: 'https://api.example',
    WEB_APP_URL: 'https://app.example',
    ...extra,
  });
}

/** Transport piloté : chaque test décide de la réponse du fournisseur. */
function transport(handler: (url: string, init?: RequestInit) => Promise<Response>): {
  http: FetchLike;
  calls: { url: string; body: string | null }[];
} {
  const calls: { url: string; body: string | null }[] = [];
  return {
    calls,
    http: (url, init) => {
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : null });
      return handler(url, init);
    },
  };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('OAuthService.authorize', () => {
  it('refuse honnêtement quand aucun identifiant d’application n’est configuré', async () => {
    const { db } = makeDb();
    const service = serviceOf(db, makeEnv());
    const error = await service
      .authorize('org-1', { platform: 'INSTAGRAM' })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConflictException);
    const message = (error as ConflictException).message;
    expect(message).toContain('META_CLIENT_ID');
    expect(message).toContain('META_CLIENT_SECRET');
    expect(message).toMatch(/Aucun identifiant d’application OAuth n’est configuré/);
  });

  it('nomme aussi l’URL publique manquante', async () => {
    const { db } = makeDb();
    const env = parseEnv({
      NODE_ENV: 'test',
      AUTH_SECRET: SECRET,
      META_CLIENT_ID: 'meta-id-test',
      META_CLIENT_SECRET: 'secret',
    });
    const error = await serviceOf(db, env)
      .authorize('org-1', { platform: 'FACEBOOK' })
      .catch((cause: unknown) => cause);
    expect((error as ConflictException).message).toContain('API_PUBLIC_URL');
  });

  it('construit une URL d’autorisation avec PKCE pour X', async () => {
    const { db } = makeDb();
    const env = makeEnv({ X_CLIENT_ID: 'client-x', X_CLIENT_SECRET: 'secret-x' });
    const result = await serviceOf(db, env).authorize('org-1', { platform: 'X' });

    expect(result.usesPkce).toBe(true);
    expect(result.authorizationUrl.startsWith(oauthApps.X.authorizeUrl)).toBe(true);
    expect(result.authorizationUrl).toContain('code_challenge_method=S256');
    expect(result.authorizationUrl).toContain(
      'redirect_uri=https%3A%2F%2Fapi.example%2Fapi%2Fv1%2Fsocial-accounts%2Foauth%2Fcallback',
    );
    expect(result.scopes).toContain('offline.access');
  });

  it('n’ajoute pas PKCE pour Meta, qui ne l’accepte pas sur ce flux', async () => {
    const { db } = makeDb();
    const env = makeEnv({ META_CLIENT_ID: 'meta-id-test', META_CLIENT_SECRET: 'secret' });
    const result = await serviceOf(db, env).authorize('org-1', { platform: 'FACEBOOK' });
    expect(result.usesPkce).toBe(false);
    expect(result.authorizationUrl).not.toContain('code_challenge');
  });

  it('refuse une réautorisation visant le compte d’une autre organisation', async () => {
    const { db } = makeDb([{ id: 'acc-1', organizationId: 'org-2' }]);
    const env = makeEnv({ X_CLIENT_ID: 'x-id-test', X_CLIENT_SECRET: 'secret' });
    await expect(
      serviceOf(db, env).authorize('org-1', { platform: 'X', socialAccountId: 'acc-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuse une marque inconnue', async () => {
    const { db } = makeDb([], []);
    const env = makeEnv({ X_CLIENT_ID: 'x-id-test', X_CLIENT_SECRET: 'secret' });
    await expect(
      serviceOf(db, env).authorize('org-1', { platform: 'X', brandId: 'brand-x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OAuthService.handleCallback', () => {
  const env = makeEnv({ X_CLIENT_ID: 'client-x', X_CLIENT_SECRET: 'secret-x' });

  function state(platform: 'X' | 'FACEBOOK', extra: { verifier?: string } = {}) {
    return createState({ organizationId: 'org-1', platform, ...extra }, SECRET, (plain) =>
      encryptSecret(plain, SECRET),
    ).state;
  }

  it('refuse un retour incomplet', async () => {
    const { db } = makeDb();
    await expect(serviceOf(db, env).handleCallback({})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('remonte le refus explicite de la plateforme', async () => {
    const { db } = makeDb();
    const error = await serviceOf(db, env)
      .handleCallback({ error: 'access_denied', error_description: 'Utilisateur refusé' })
      .catch((cause: unknown) => cause);
    expect((error as BadRequestException).message).toContain('Utilisateur refusé');
  });

  it('refuse un état altéré', async () => {
    const { db } = makeDb();
    await expect(
      serviceOf(db, env).handleCallback({ state: 'faux.etat', code: 'code' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('échange le code, lit le profil et enregistre des jetons chiffrés', async () => {
    const { db, accounts, audits } = makeDb();
    const { http, calls } = transport(async (url) => {
      if (url === oauthApps.X.tokenUrl) {
        return json({
          access_token: 'jeton-acces',
          refresh_token: 'jeton-rafraichissement',
          expires_in: 7200,
        });
      }
      return json({
        data: {
          id: '42',
          username: 'nova',
          name: 'Nova Studio',
          profile_image_url: 'https://x/a.png',
        },
      });
    });

    const service = serviceOf(db, env, http);
    const result = await service.handleCallback({
      state: state('X', { verifier: 'verifier-pkce' }),
      code: 'code-1',
    });

    expect(result.platform).toBe('X');
    expect(result.account.username).toBe('nova');
    // Aucun jeton brut ne sort de l'API.
    expect(JSON.stringify(result.account)).not.toContain('jeton-acces');
    expect(result.account.hasAccessToken).toBe(true);
    expect(result.account.hasRefreshToken).toBe(true);
    expect(result.account.tokenExpiresAt).not.toBeNull();

    const row = accounts[0]!;
    expect(row.accessToken).not.toBe('jeton-acces');
    expect(decryptSecret(row.accessToken!, SECRET)).toBe('jeton-acces');
    expect(row.externalId).toBe('42');

    // Le vérificateur PKCE accompagne bien l'échange.
    const tokenCall = calls.find((call) => call.url === oauthApps.X.tokenUrl)!;
    expect(tokenCall.body).toContain('grant_type=authorization_code');
    expect(tokenCall.body).toContain('code_verifier=verifier-pkce');
    expect(tokenCall.body).toContain('client_secret=secret-x');

    expect(audits.map((entry) => entry.action)).toContain('social_account.oauth_connected');
  });

  it('exige un vérificateur PKCE pour une plateforme qui l’impose', async () => {
    const { db } = makeDb();
    const { http } = transport(async () => json({ access_token: 'x' }));
    const error = await serviceOf(db, env, http)
      .handleCallback({ state: state('X'), code: 'code-1' })
      .catch((cause: unknown) => cause);
    expect((error as BadRequestException).message).toMatch(/PKCE/);
  });

  it('remonte un échange de jeton refusé', async () => {
    const { db } = makeDb();
    const { http } = transport(async () =>
      json({ error: 'invalid_grant', error_description: 'code expiré' }, 400),
    );
    const error = await serviceOf(db, env, http)
      .handleCallback({ state: state('X', { verifier: 'verifier-pkce' }), code: 'code-1' })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as BadGatewayException).message).toContain('code expiré');
  });

  it('échoue quand le fournisseur ne renvoie pas de jeton', async () => {
    const { db } = makeDb();
    const { http } = transport(async () => json({ token_type: 'bearer' }));
    await expect(
      serviceOf(db, env, http).handleCallback({
        state: state('X', { verifier: 'verifier-pkce' }),
        code: 'code-1',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('échoue quand le profil est inaccessible', async () => {
    const { db } = makeDb();
    const { http } = transport(async (url) =>
      url === oauthApps.X.tokenUrl
        ? json({ access_token: 'jeton' })
        : json({ error: 'invalid' }, 401),
    );
    const error = await serviceOf(db, env, http)
      .handleCallback({ state: state('X', { verifier: 'verifier-pkce' }), code: 'code-1' })
      .catch((cause: unknown) => cause);
    expect((error as BadGatewayException).message).toMatch(/401/);
  });
});

describe('OAuthService.refresh', () => {
  const env = makeEnv({ X_CLIENT_ID: 'client-x', X_CLIENT_SECRET: 'secret-x' });

  const seeded = (overrides: Partial<AccountRow>) =>
    makeDb([
      {
        id: 'acc-1',
        platform: 'X',
        accessToken: encryptSecret('ancien-acces', SECRET),
        refreshToken: encryptSecret('ancien-refresh', SECRET),
        lastError: 'panne précédente',
        lastErrorAt: new Date('2026-01-01T00:00:00Z'),
        ...overrides,
      },
    ]);

  it('refuse une plateforme sans jeton de rafraîchissement', async () => {
    const { db } = seeded({ platform: 'FACEBOOK' });
    const error = await serviceOf(db, env)
      .refresh('org-1', 'acc-1')
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toMatch(/relancez la connexion/i);
  });

  it('refuse quand aucun jeton de rafraîchissement n’est enregistré', async () => {
    const { db } = seeded({ refreshToken: null });
    await expect(serviceOf(db, env).refresh('org-1', 'acc-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuse quand les identifiants d’application manquent', async () => {
    const { db } = seeded({});
    const error = await serviceOf(db, makeEnv())
      .refresh('org-1', 'acc-1')
      .catch((cause: unknown) => cause);
    expect((error as ConflictException).message).toContain('X_CLIENT_ID');
  });

  it('renouvelle les jetons et efface la dernière erreur', async () => {
    const { db, accounts, audits } = seeded({});
    const { http, calls } = transport(async () =>
      json({ access_token: 'nouveau', expires_in: 3600 }),
    );
    const account = await serviceOf(db, env, http).refresh('org-1', 'acc-1');

    expect(account.status).toBe('CONNECTED');
    expect(account.lastError).toBeNull();
    expect(decryptSecret(accounts[0]!.accessToken!, SECRET)).toBe('nouveau');
    expect(calls[0]!.body).toContain('grant_type=refresh_token');
    expect(audits.map((entry) => entry.action)).toContain('social_account.refreshed');
  });

  it('conserve le jeton de rafraîchissement quand la réponse l’omet', async () => {
    const { db, accounts } = seeded({});
    const { http } = transport(async () => json({ access_token: 'nouveau' }));
    await serviceOf(db, env, http).refresh('org-1', 'acc-1');
    expect(decryptSecret(accounts[0]!.refreshToken!, SECRET)).toBe('ancien-refresh');
  });

  it('remplace le jeton de rafraîchissement quand la réponse en fournit un', async () => {
    const { db, accounts } = seeded({});
    const { http } = transport(async () =>
      json({ access_token: 'nouveau', refresh_token: 'refresh-tournant' }),
    );
    await serviceOf(db, env, http).refresh('org-1', 'acc-1');
    expect(decryptSecret(accounts[0]!.refreshToken!, SECRET)).toBe('refresh-tournant');
  });
});

describe('OAuthService.sync', () => {
  const configured = makeEnv({ X_CLIENT_ID: 'client-x', X_CLIENT_SECRET: 'secret-x' });

  it('enregistre l’absence d’identifiants sans appeler le réseau', async () => {
    const { db, accounts } = makeDb([
      { id: 'acc-1', platform: 'X', accessToken: encryptSecret('jeton', SECRET) },
    ]);
    const { http, calls } = transport(async () => json({}));
    const account = await serviceOf(db, makeEnv(), http).sync('org-1', 'acc-1');

    expect(calls).toHaveLength(0);
    expect(account.status).toBe('ERROR');
    expect(account.lastError).toContain('X_CLIENT_ID');
    expect(account.lastErrorAt).not.toBeNull();
    expect(account.lastSyncedAt).not.toBeNull();
    expect(accounts[0]!.status).toBe('ERROR');
  });

  it('refuse de synchroniser sans jeton lisible', async () => {
    const { db } = makeDb([{ id: 'acc-1', platform: 'X', accessToken: null }]);
    await expect(serviceOf(db, configured).sync('org-1', 'acc-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('met à jour le profil au succès et efface l’erreur', async () => {
    const { db, accounts } = makeDb([
      {
        id: 'acc-1',
        platform: 'X',
        accessToken: encryptSecret('jeton', SECRET),
        lastError: 'panne',
        lastErrorAt: new Date(),
      },
    ]);
    const { http } = transport(async () =>
      json({ data: { id: '42', username: 'nova-2', name: 'Nova Studio' } }),
    );
    const account = await serviceOf(db, configured, http).sync('org-1', 'acc-1');

    expect(account.status).toBe('CONNECTED');
    expect(account.displayName).toBe('Nova Studio');
    expect(account.lastError).toBeNull();
    expect(accounts[0]!.externalId).toBe('42');
    // Le pseudo local n'est pas réécrit : il fait partie de la clé d'unicité
    // (organisation + plateforme + pseudo) qui rattache les reconnexions.
    expect(account.username).toBe('nova');
  });

  it('enregistre l’échec du fournisseur au lieu de lever', async () => {
    const { db } = makeDb([
      { id: 'acc-1', platform: 'X', accessToken: encryptSecret('jeton', SECRET) },
    ]);
    const { http } = transport(async () => json({ error: 'revoked' }, 401));
    const account = await serviceOf(db, configured, http).sync('org-1', 'acc-1');
    expect(account.status).toBe('ERROR');
    expect(account.lastError).toMatch(/401/);
  });

  it('ignore un compte d’une autre organisation', async () => {
    const { db } = makeDb([{ id: 'acc-1', organizationId: 'org-2' }]);
    await expect(serviceOf(db, configured).sync('org-1', 'acc-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('OAuthService.health', () => {
  it('qualifie chaque connexion et nomme les identifiants manquants', async () => {
    const { db } = makeDb([
      { id: 'acc-1', platform: 'X', status: 'CONNECTED', accessToken: 'chiffré' },
      { id: 'acc-2', platform: 'FACEBOOK', status: 'REVOKED', accessToken: null },
      {
        id: 'acc-3',
        platform: 'LINKEDIN',
        status: 'CONNECTED',
        accessToken: 'chiffré',
        lastError: 'panne',
        lastErrorAt: new Date(),
      },
    ]);
    const rows = await serviceOf(
      db,
      makeEnv({ X_CLIENT_ID: 'x-id-test', X_CLIENT_SECRET: 'x-secret-test' }),
    ).health('org-1');

    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.id === 'acc-1')?.state).toBe('OK');
    expect(rows.find((row) => row.id === 'acc-1')?.missingCredentials).toEqual([]);
    expect(rows.find((row) => row.id === 'acc-2')?.state).toBe('REVOKED');
    expect(rows.find((row) => row.id === 'acc-3')?.state).toBe('ERROR');
    expect(rows.find((row) => row.id === 'acc-3')?.missingCredentials).toEqual([
      'LINKEDIN_CLIENT_ID',
      'LINKEDIN_CLIENT_SECRET',
    ]);
  });

  it('ne divulgue jamais un jeton', async () => {
    const { db } = makeDb([
      {
        id: 'acc-1',
        platform: 'X',
        accessToken: encryptSecret('secret-en-clair', SECRET),
        refreshToken: encryptSecret('refresh-en-clair', SECRET),
      },
    ]);
    const rows = await serviceOf(db, makeEnv()).health('org-1');
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('secret-en-clair');
    expect(serialized).not.toContain('refresh-en-clair');
    expect(rows[0]!.hasAccessToken).toBe(true);
    expect(rows[0]!.hasRefreshToken).toBe(true);
  });
});
