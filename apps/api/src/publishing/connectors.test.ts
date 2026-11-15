import { afterEach, describe, expect, it, vi } from 'vitest';
import { socialPlatforms } from '@ass/shared';
import { parseEnv } from '../config/env.js';
import {
  createConnector,
  createWebhookConnector,
  describePlatforms,
  describeReadiness,
  inertConnector,
  resolveConnector,
  type SocialPost,
} from './connectors.js';

const post: SocialPost = {
  platform: 'LINKEDIN',
  accountUsername: 'studio',
  postType: 'TEXT',
  text: 'Annonce de test.',
  title: null,
  mediaIds: [],
};

function stubFetch(implementation: (url: string, init: RequestInit) => Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => implementation(url, init)),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adaptateur inerte', () => {
  it('échoue explicitement plutôt que de simuler une publication', async () => {
    const result = await inertConnector.publish(post);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NOT_CONFIGURED');
    expect(result.externalId).toBeNull();
    expect(result.externalUrl).toBeNull();
  });

  it('le message indique la marche à suivre', async () => {
    const result = await inertConnector.publish(post);
    expect(result.error?.message).toMatch(/Publiez manuellement/i);
  });
});

describe('resolveConnector', () => {
  it('reste inerte sans transport configuré', () => {
    expect(resolveConnector(parseEnv({})).kind).toBe('NONE');
  });

  it('bascule sur le webhook quand l’URL est fournie', () => {
    const env = parseEnv({ PUBLISH_WEBHOOK_URL: 'https://hook.example/publish' });
    expect(resolveConnector(env).kind).toBe('WEBHOOK');
  });
});

describe('describeReadiness', () => {
  it('annonce l’absence de configuration', () => {
    const report = describeReadiness(parseEnv({}));
    expect(report.ready).toBe(false);
    expect(report.kind).toBe('NONE');
  });

  it('annonce un transport prêt et sa contrainte', () => {
    const report = describeReadiness(parseEnv({ PUBLISH_WEBHOOK_URL: 'https://hook.example' }));
    expect(report.ready).toBe(true);
    expect(report.kind).toBe('WEBHOOK');
    expect(report.message).toMatch(/identifiant ou une URL/i);
  });
});

describe('transport webhook', () => {
  const env = parseEnv({
    PUBLISH_WEBHOOK_URL: 'https://hook.example/publish',
    PUBLISH_WEBHOOK_SECRET: 'secret-de-test',
    PUBLISH_WEBHOOK_TIMEOUT_MS: '5000',
  });

  it('transmet la plateforme et le post complet', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    stubFetch(async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ id: 'ext-1', url: 'https://social.example/p/1' }), {
        status: 200,
      });
    });

    const result = await createWebhookConnector(env).publish(post);
    expect(result.ok).toBe(true);
    expect(result.externalId).toBe('ext-1');
    expect(result.externalUrl).toBe('https://social.example/p/1');

    expect(captured).not.toBeNull();
    const { url, init } = captured!;
    expect(url).toBe('https://hook.example/publish');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer secret-de-test');
    const body = JSON.parse(String(init.body)) as { platform: string; post: SocialPost };
    expect(body.platform).toBe('LINKEDIN');
    expect(body.post.text).toBe('Annonce de test.');
  });

  it('accepte une réponse qui ne fournit qu’une URL', async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ url: 'https://social.example/p/2' }), {
          status: 200,
        }),
    );
    const result = await createWebhookConnector(env).publish(post);
    expect(result.ok).toBe(true);
    expect(result.externalId).toBeNull();
    expect(result.externalUrl).toBe('https://social.example/p/2');
  });

  it('refuse de compter un 200 sans référence externe comme un succès', async () => {
    stubFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const result = await createWebhookConnector(env).publish(post);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('REJECTED');
    expect(result.error?.message).toMatch(/sans identifiant ni URL/i);
  });

  it('remonte un statut HTTP en erreur de transport', async () => {
    stubFetch(async () => new Response('quota dépassé', { status: 429 }));
    const result = await createWebhookConnector(env).publish(post);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('TRANSPORT_ERROR');
    expect(result.error?.message).toMatch(/429/);
    expect(result.error?.message).toMatch(/quota dépassé/);
  });

  it('remonte un réseau injoignable', async () => {
    stubFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await createWebhookConnector(env).publish(post);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('TRANSPORT_ERROR');
    expect(result.error?.message).toMatch(/ECONNREFUSED/);
  });

  it('traite l’abandon comme un dépassement de délai', async () => {
    stubFetch(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    const result = await createWebhookConnector(env).publish(post);
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/Délai de 5000 ms dépassé/);
  });

  it('échoue proprement quand l’URL a disparu de la configuration', async () => {
    const withoutUrl = parseEnv({ PUBLISH_WEBHOOK_SECRET: 'secret-de-test' });
    const result = await createWebhookConnector(withoutUrl).publish(post);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NOT_CONFIGURED');
  });
});

describe('adaptateur de plateforme (§9.4)', () => {
  const env = parseEnv({ PUBLISH_WEBHOOK_URL: 'https://hook.example/publish' });

  it('déclare les capacités réelles de la plateforme', async () => {
    const capabilities = await createConnector(env, 'INSTAGRAM').getCapabilities();
    expect(capabilities.supports).toContain('CAROUSEL');
    expect(capabilities.supports).not.toContain('TEXT');
    expect(capabilities.requiresMedia).toContain('IMAGE');
    expect(capabilities.maxMedia).toBe(10);
    expect(capabilities.maxChars).toBe(2_200);
    expect(capabilities.fallback).toBe('MANUAL');
  });

  it('ne suppose pas que les réseaux se ressemblent', async () => {
    const tiktok = await createConnector(env, 'TIKTOK').getCapabilities();
    const linkedin = await createConnector(env, 'LINKEDIN').getCapabilities();
    expect(tiktok.supports).not.toEqual(linkedin.supports);
    expect(tiktok.maxMedia).toBe(1);
    expect(linkedin.maxMedia).toBe(9);
  });

  it('signale les identifiants manquants dans les capacités', async () => {
    const capabilities = await createConnector(env, 'YOUTUBE').getCapabilities();
    expect(capabilities.missingCredentials).toEqual(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
    expect(capabilities.canPublish).toBe(false);
  });

  it('déclare l’envoi possible quand tout est configuré', async () => {
    const configured = parseEnv({
      PUBLISH_WEBHOOK_URL: 'https://hook.example/publish',
      GOOGLE_CLIENT_ID: 'id-de-test',
      GOOGLE_CLIENT_SECRET: 'secret-de-test',
    });
    const capabilities = await createConnector(configured, 'YOUTUBE').getCapabilities();
    expect(capabilities.missingCredentials).toEqual([]);
    expect(capabilities.canPublish).toBe(true);
    expect(capabilities.operations).toContain('publish');
  });

  it('ne liste jamais publish sans transport', async () => {
    const capabilities = await createConnector(parseEnv({}), 'LINKEDIN').getCapabilities();
    expect(capabilities.operations).not.toContain('publish');
    expect(capabilities.operations).toContain('validatePost');
    expect(capabilities.operations).toContain('getCapabilities');
  });

  it('valide un texte conforme', async () => {
    const result = await createConnector(env, 'LINKEDIN').validatePost(post);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.charCount).toBe(post.text.length);
    expect(result.charLimit).toBe(3_000);
  });

  it('refuse un texte seul sur Instagram, qui exige un média', async () => {
    const result = await createConnector(env, 'INSTAGRAM').validatePost({
      ...post,
      platform: 'INSTAGRAM',
      postType: 'IMAGE',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/média/i);
  });

  it('refuse un format que la plateforme n’accepte pas', async () => {
    const result = await createConnector(env, 'TIKTOK').validatePost({
      ...post,
      platform: 'TIKTOK',
      postType: 'TEXT',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/n’accepte pas le format TEXT/);
  });

  it('délègue l’envoi au transport configuré', async () => {
    stubFetch(async () => new Response(JSON.stringify({ id: 'ext-9' }), { status: 200 }));
    const result = await createConnector(env, 'LINKEDIN').publish(post);
    expect(result.ok).toBe(true);
    expect(result.externalId).toBe('ext-9');
  });

  it('échoue honnêtement sans transport', async () => {
    const result = await createConnector(parseEnv({}), 'LINKEDIN').publish(post);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NOT_CONFIGURED');
  });

  it('ne prétend pas connaître l’état distant d’une publication', async () => {
    const status = await createConnector(env, 'LINKEDIN').getPublishStatus('ext-9');
    expect(status.ok).toBe(false);
    expect(status.state).toBe('UNKNOWN');
    expect(status.message).toMatch(/ne permet pas de relire/i);
  });

  it('ne fabrique aucune statistique', async () => {
    const analytics = await createConnector(env, 'LINKEDIN').getAnalytics('ext-9');
    expect(analytics.ok).toBe(false);
    expect(analytics.metrics).toBeNull();
    expect(analytics.message).toMatch(/Aucune statistique/i);
  });

  it('renvoie la connexion au flux OAuth plutôt que de la simuler', async () => {
    const connector = createConnector(env, 'LINKEDIN');
    const connect = await connector.connect();
    expect(connect.ok).toBe(false);
    expect(connect.code).toBe('NOT_SUPPORTED');
    expect(connect.message).toMatch(/POST \/social-accounts\/connect/);

    const refresh = await connector.refreshToken();
    expect(refresh.code).toBe('NOT_SUPPORTED');
    expect(refresh.message).toMatch(/refresh/);

    expect(await connector.getAccountInfo()).toBeNull();
  });

  it('explique qu’une révocation exige les identifiants du fournisseur', async () => {
    const withoutCredentials = await createConnector(env, 'LINKEDIN').disconnect();
    expect(withoutCredentials.code).toBe('NOT_CONFIGURED');
    expect(withoutCredentials.message).toMatch(/LINKEDIN_CLIENT_ID/);
  });

  it('décrit chaque plateforme, sans en oublier', () => {
    const rows = describePlatforms(env);
    expect(rows.map((row) => row.platform)).toEqual([...socialPlatforms]);
    for (const row of rows) {
      expect(row.transport).toBe('WEBHOOK');
      expect(row.canPublish).toBe(false);
      expect(row.missingCredentials.length).toBeGreaterThan(0);
    }
  });
});
