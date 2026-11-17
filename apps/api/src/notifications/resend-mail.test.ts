import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResendTransport } from './mail.js';

const API_KEY = 're_fake_key_for_tests_123456';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('transport e-mail Resend (§15)', () => {
  it('reste inerte sans clé API', async () => {
    const transport = createResendTransport({});
    expect(transport.kind).toBe('NONE');
    expect(transport.describe().available).toBe(false);
    const result = await transport.send({ to: 'x@example.com', subject: 's', text: 't' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NO_PROVIDER');
  });

  it('envoie le message avec l’API et l’expéditeur configuré', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const transport = createResendTransport({
      apiKey: API_KEY,
      from: 'AI Social Studio <noreply@example.com>',
    });
    const result = await transport.send({
      to: 'invite@example.com',
      subject: 'Invitation',
      text: 'Bonjour',
    });

    expect(result).toEqual({ ok: true });
    expect(transport.describe()).toEqual({ available: true, reason: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'AI Social Studio <noreply@example.com>',
      to: ['invite@example.com'],
      subject: 'Invitation',
      text: 'Bonjour',
    });
  });

  it('transforme une erreur Resend en échec sans exposer la clé', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ message: 'Invalid API key' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const transport = createResendTransport({ apiKey: API_KEY });
    const result = await transport.send({ to: 'x@example.com', subject: 's', text: 't' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TRANSPORT_ERROR');
      expect(result.message).toContain('Resend 401');
      expect(result.message).not.toContain(API_KEY);
    }
  });
});
