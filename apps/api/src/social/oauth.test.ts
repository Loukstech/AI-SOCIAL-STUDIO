import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assessConnection,
  authorizationUrl,
  isPkceVerifier,
  missingCredentials,
  oauthApps,
  providerSpecs,
  socialPlatforms,
  EXPIRING_WINDOW_HOURS,
  PKCE_VERIFIER_LENGTH,
} from '@ass/shared';
import {
  codeChallenge,
  createState,
  createVerifier,
  readState,
  STATE_TTL_SECONDS,
} from './oauth-state.js';
import { decryptSecret, encryptSecret } from '../auth/crypto.js';
import { extractProfile, profilePaths } from './profile.js';

const SECRET = 'secret-de-test-suffisamment-long';
const encrypt = (plain: string): string => `chiffre:${plain}`;

describe('PKCE (RFC 7636)', () => {
  it('reproduit le vecteur de test du RFC 7636 annexe B', () => {
    // Vérificateur et défi publiés dans le RFC : la preuve que l'algorithme
    // est bien BASE64URL(SHA256(verifier)) et pas autre chose.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(codeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('produit un vérificateur de 43 caractères conformes', () => {
    const verifier = createVerifier();
    expect(verifier).toHaveLength(PKCE_VERIFIER_LENGTH);
    expect(isPkceVerifier(verifier)).toBe(true);
  });

  it('ne réutilise jamais le même vérificateur', () => {
    expect(createVerifier()).not.toBe(createVerifier());
  });

  it('refuse un vérificateur hors format', () => {
    expect(isPkceVerifier('trop-court')).toBe(false);
    expect(isPkceVerifier('a'.repeat(129))).toBe(false);
    expect(isPkceVerifier('caractères-accentués-éàü'.padEnd(43, 'a'))).toBe(false);
  });
});

describe('état OAuth', () => {
  it('signe et relit un état complet', () => {
    const { state, expiresAt } = createState(
      {
        organizationId: 'org-1',
        platform: 'LINKEDIN',
        socialAccountId: 'acc-1',
        brandId: 'brand-1',
        verifier: 'verifier-en-clair',
      },
      SECRET,
      encrypt,
    );
    const payload = readState(state, SECRET);
    expect(payload?.o).toBe('org-1');
    expect(payload?.p).toBe('LINKEDIN');
    expect(payload?.a).toBe('acc-1');
    expect(payload?.b).toBe('brand-1');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('ne laisse jamais le vérificateur PKCE en clair dans l’URL', () => {
    // Chiffrement réel : l'état transite par le navigateur, un vérificateur
    // lisible annulerait l'intérêt de PKCE pour qui intercepterait le code.
    const { state } = createState(
      { organizationId: 'org-1', platform: 'X', verifier: 'verifier-en-clair' },
      SECRET,
      (plain) => encryptSecret(plain, SECRET),
    );
    const decoded = Buffer.from(state.split('.')[0]!, 'base64url').toString('utf8');
    expect(decoded).not.toContain('verifier-en-clair');
    const payload = readState(state, SECRET);
    expect(payload?.v).toBeDefined();
    expect(decryptSecret(payload!.v!, SECRET)).toBe('verifier-en-clair');
  });

  it('refuse un état dont la signature a été altérée', () => {
    const { state } = createState({ organizationId: 'org-1', platform: 'X' }, SECRET, encrypt);
    const [body, signature] = state.split('.') as [string, string];
    const forged = Buffer.from(
      JSON.stringify({ o: 'org-2', p: 'X', n: 'abc', exp: Math.floor(Date.now() / 1000) + 600 }),
    ).toString('base64url');
    expect(readState(`${forged}.${signature}`, SECRET)).toBeNull();
    expect(readState(`${body}.${signature}x`, SECRET)).toBeNull();
  });

  it('refuse un état signé avec un autre secret', () => {
    const { state } = createState({ organizationId: 'org-1', platform: 'X' }, SECRET, encrypt);
    expect(readState(state, 'un-autre-secret-complet')).toBeNull();
  });

  it('refuse un état expiré', () => {
    const past = new Date(Date.now() - (STATE_TTL_SECONDS + 60) * 1000);
    const { state } = createState(
      { organizationId: 'org-1', platform: 'X' },
      SECRET,
      encrypt,
      past,
    );
    expect(readState(state, SECRET)).toBeNull();
  });

  it('refuse un état malformé', () => {
    expect(readState('n’importe-quoi', SECRET)).toBeNull();
    expect(readState('a.b.c', SECRET)).toBeNull();
    expect(readState('', SECRET)).toBeNull();
  });

  it('refuse une plateforme hors contrat', () => {
    const body = Buffer.from(
      JSON.stringify({
        o: 'org-1',
        p: 'MYSPACE',
        n: 'abc',
        exp: Math.floor(Date.now() / 1000) + 600,
      }),
    ).toString('base64url');
    // Signature valide : seule la valeur de `p` doit faire échouer la lecture.
    const signature = createHmac('sha256', SECRET).update(body).digest('base64url');
    expect(readState(`${body}.${signature}`, SECRET)).toBeNull();
  });
});

describe('authorizationUrl', () => {
  const base = {
    clientId: 'client-123',
    redirectUri: 'https://api.example/api/v1/social-accounts/oauth/callback',
    state: 'etat-signe',
    scopes: ['tweet.read', 'tweet.write'],
  };

  it('ajoute la méthode S256 seulement avec un défi', () => {
    const without = authorizationUrl(oauthApps.X, base);
    expect(without).toContain('response_type=code');
    expect(without).toContain('client_id=client-123');
    expect(without).not.toContain('code_challenge');

    const withChallenge = authorizationUrl(oauthApps.X, { ...base, codeChallenge: 'defi' });
    expect(withChallenge).toContain('code_challenge=defi');
    expect(withChallenge).toContain('code_challenge_method=S256');
  });

  it('encode les permissions séparées par des espaces', () => {
    const url = authorizationUrl(oauthApps.GOOGLE, {
      ...base,
      scopes: ['https://www.googleapis.com/auth/youtube.upload'],
    });
    expect(url).toContain('scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube.upload');
  });

  it('encode l’URL de retour et l’état', () => {
    const url = authorizationUrl(oauthApps.META, base);
    expect(url).toContain('redirect_uri=https%3A%2F%2Fapi.example');
    expect(url).toContain('state=etat-signe');
  });

  it('accepte des paramètres propres au fournisseur', () => {
    const url = authorizationUrl(oauthApps.META, { ...base, extra: { auth_type: 'rerequest' } });
    expect(url).toContain('auth_type=rerequest');
  });

  it('suit le format propre à TikTok : client_key, scopes à virgule, sans PKCE', () => {
    const url = new URL(
      authorizationUrl(oauthApps.TIKTOK, { ...base, scopes: ['user.info.basic', 'video.list'] }),
    );
    expect(url.searchParams.get('client_key')).toBe('client-123');
    expect(url.searchParams.has('client_id')).toBe(false);
    expect(url.searchParams.get('scope')).toBe('user.info.basic,video.list');
    expect(oauthApps.TIKTOK.usesPkce).toBe(false);
    // La demande de validation TikTok ne déclare que ce scope.
    expect(providerSpecs.TIKTOK.scopes).toEqual(['user.info.basic']);
  });

  it('pointe sur l’URL d’autorisation déclarée', () => {
    for (const app of Object.values(oauthApps)) {
      expect(authorizationUrl(app, base).startsWith(app.authorizeUrl)).toBe(true);
    }
  });
});

describe('missingCredentials', () => {
  it('liste l’identifiant et le secret quand rien n’est configuré', () => {
    expect(missingCredentials(providerSpecs.INSTAGRAM, {})).toEqual([
      'META_CLIENT_ID',
      'META_CLIENT_SECRET',
    ]);
  });

  it('ne réclame que l’identifiant quand le secret est présent', () => {
    expect(missingCredentials(providerSpecs.LINKEDIN, { LINKEDIN_CLIENT_SECRET: 'x' })).toEqual([
      'LINKEDIN_CLIENT_ID',
    ]);
  });

  it('ne réclame rien quand tout est renseigné', () => {
    expect(
      missingCredentials(providerSpecs.YOUTUBE, {
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
      }),
    ).toEqual([]);
  });

  it('traite une valeur vide comme absente', () => {
    expect(
      missingCredentials(providerSpecs.X, { X_CLIENT_ID: '   ', X_CLIENT_SECRET: '' }),
    ).toEqual(['X_CLIENT_ID', 'X_CLIENT_SECRET']);
  });

  it('couvre toutes les plateformes sans exception', () => {
    for (const platform of socialPlatforms) {
      expect(() => missingCredentials(providerSpecs[platform], {})).not.toThrow();
    }
  });
});

describe('scopes TikTok', () => {
  // TikTok refuse l'autorisation si un scope demandé n'est pas activé sur
  // l'application. Tant que la Content Posting API n'est pas validée côté
  // portail, seuls les scopes de Login Kit doivent être demandés : sinon
  // l'écran d'autorisation échoue et aucun compte ne peut être connecté.
  it('ne demande que les scopes de Login Kit', () => {
    expect(providerSpecs.TIKTOK.scopes).toEqual(['user.info.basic']);
  });

  it('ne demande aucun scope de publication', () => {
    for (const scope of providerSpecs.TIKTOK.scopes) {
      expect(scope).not.toMatch(/publish|upload/);
    }
  });
});

describe('assessConnection', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');
  const inHours = (hours: number): string =>
    new Date(now.getTime() + hours * 3_600_000).toISOString();

  it('signale une connexion saine', () => {
    const result = assessConnection({
      status: 'CONNECTED',
      hasAccessToken: true,
      tokenExpiresAt: null,
      now,
    });
    expect(result.state).toBe('OK');
    expect(result.guidance).toBeNull();
    expect(result.hoursLeft).toBeNull();
  });

  it('signale un jeton bientôt expiré', () => {
    const result = assessConnection({
      status: 'CONNECTED',
      hasAccessToken: true,
      tokenExpiresAt: inHours(EXPIRING_WINDOW_HOURS - 1),
      now,
    });
    expect(result.state).toBe('EXPIRING');
    expect(result.hoursLeft).toBeCloseTo(EXPIRING_WINDOW_HOURS - 1, 1);
  });

  it('signale un jeton expiré', () => {
    const result = assessConnection({
      status: 'CONNECTED',
      hasAccessToken: true,
      tokenExpiresAt: inHours(-5),
      now,
    });
    expect(result.state).toBe('EXPIRED');
    expect(result.guidance).toMatch(/renouvelez/i);
  });

  it('ne signale pas d’expiration au-delà de la fenêtre', () => {
    const result = assessConnection({
      status: 'CONNECTED',
      hasAccessToken: true,
      tokenExpiresAt: inHours(EXPIRING_WINDOW_HOURS + 1),
      now,
    });
    expect(result.state).toBe('OK');
  });

  it('distingue l’absence de jeton', () => {
    const result = assessConnection({
      status: 'EXPIRED',
      hasAccessToken: false,
      tokenExpiresAt: null,
      now,
    });
    expect(result.state).toBe('NO_TOKEN');
  });

  it('signale une erreur de synchronisation', () => {
    const result = assessConnection({
      status: 'CONNECTED',
      hasAccessToken: true,
      tokenExpiresAt: null,
      lastErrorAt: now.toISOString(),
      now,
    });
    expect(result.state).toBe('ERROR');
    expect(result.guidance).toMatch(/synchronisation/i);
  });

  it('fait primer la révocation sur tout le reste', () => {
    const result = assessConnection({
      status: 'REVOKED',
      hasAccessToken: true,
      tokenExpiresAt: inHours(48),
      lastErrorAt: now.toISOString(),
      now,
    });
    expect(result.state).toBe('REVOKED');
  });

  it('fait primer l’expiration sur une erreur enregistrée', () => {
    const result = assessConnection({
      status: 'CONNECTED',
      hasAccessToken: true,
      tokenExpiresAt: inHours(-1),
      lastErrorAt: now.toISOString(),
      now,
    });
    expect(result.state).toBe('EXPIRED');
  });
});

describe('extractProfile', () => {
  it('lit un profil Facebook', () => {
    const profile = extractProfile('FACEBOOK', {
      id: '101',
      name: 'Nova Studio',
      picture: { data: { url: 'https://cdn.example/a.jpg' } },
    });
    expect(profile).toEqual({
      externalId: '101',
      username: 'Nova Studio',
      displayName: 'Nova Studio',
      avatarUrl: 'https://cdn.example/a.jpg',
    });
  });

  it('lit un profil Instagram professionnel', () => {
    const profile = extractProfile('INSTAGRAM', {
      id: '178414',
      username: 'nova.studio',
      name: 'Nova',
      profile_picture_url: 'https://cdn.example/i.jpg',
    });
    expect(profile.username).toBe('nova.studio');
    expect(profile.avatarUrl).toBe('https://cdn.example/i.jpg');
  });

  it('lit un profil X imbriqué sous data', () => {
    const profile = extractProfile('X', {
      data: {
        id: '42',
        username: 'nova',
        name: 'Nova Studio',
        profile_image_url: 'https://x/a.png',
      },
    });
    expect(profile.externalId).toBe('42');
    expect(profile.username).toBe('nova');
  });

  it('lit un profil TikTok imbriqué sous data.user', () => {
    const profile = extractProfile('TIKTOK', {
      data: { user: { open_id: 'open-1', union_id: 'union-1', display_name: 'Nova' } },
    });
    expect(profile.externalId).toBe('open-1');
    expect(profile.username).toBe('Nova');
  });

  it('lit un profil LinkedIn OpenID', () => {
    const profile = extractProfile('LINKEDIN', {
      sub: 'li-1',
      preferred_username: 'nova-studio',
      name: 'Nova Studio',
      picture: 'https://li/a.jpg',
    });
    expect(profile.externalId).toBe('li-1');
    expect(profile.username).toBe('nova-studio');
  });

  it('retombe sur l’identifiant quand le nom d’utilisateur manque', () => {
    const profile = extractProfile('FACEBOOK', { id: '101' });
    expect(profile.username).toBe('101');
    expect(profile.displayName).toBeNull();
    expect(profile.avatarUrl).toBeNull();
  });

  it('refuse un profil sans identifiant externe', () => {
    expect(() => extractProfile('FACEBOOK', { name: 'Nova' })).toThrow(/identifiant externe/i);
    expect(() => extractProfile('FACEBOOK', null)).toThrow(/identifiant externe/i);
    expect(() => extractProfile('FACEBOOK', { id: '   ' })).toThrow(/identifiant externe/i);
  });

  it('décrit où chercher pour chaque plateforme', () => {
    for (const platform of socialPlatforms) {
      const paths = profilePaths[platform];
      expect(paths.id.length).toBeGreaterThan(0);
      expect(paths.username.length).toBeGreaterThan(0);
    }
  });
});
