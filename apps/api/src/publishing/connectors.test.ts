import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../config/env.js';
import {
  createWebhookConnector,
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
