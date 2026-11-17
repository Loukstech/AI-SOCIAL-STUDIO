import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Db } from '../common/validation.js';
import { parseEnv } from '../config/env.js';
import { ObjectStorageService } from './object-storage.service.js';

const SECRET = 'secret-de-test-suffisamment-long';
const KEY = 'org/org-1/media-1/visuel.png';

function environment(overrides: Record<string, string> = {}) {
  return parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    AUTH_SECRET: SECRET,
    API_PUBLIC_URL: 'https://api.example.com',
    ...overrides,
  });
}

function databaseStub() {
  const rows = new Map<
    string,
    { data: Uint8Array; mimeType: string; sizeBytes: number; checksum: string }
  >();
  const client = {
    mediaObject: {
      upsert: async ({
        where,
        create,
      }: {
        where: { storageKey: string };
        create: {
          data: Uint8Array;
          mimeType: string;
          sizeBytes: number;
          checksum: string;
        };
      }) => {
        const stored = { ...create };
        rows.set(where.storageKey, stored);
        return { storageKey: where.storageKey, ...stored };
      },
      findUnique: async ({ where }: { where: { storageKey: string } }) => {
        const stored = rows.get(where.storageKey);
        return stored ? { ...stored } : null;
      },
      deleteMany: async ({ where }: { where: { storageKey: string } }) => {
        const count = rows.delete(where.storageKey) ? 1 : 0;
        return { count };
      },
    },
  };
  return { db: { client } as unknown as Db, rows };
}

function serviceWith(overrides: Record<string, string> = {}) {
  const { db, rows } = databaseStub();
  return { service: new ObjectStorageService(environment(overrides), db), rows };
}

describe('stockage binaire dans PostgreSQL (§12)', () => {
  it('utilise le pilote database par défaut et signe une URL de l’API', async () => {
    const { service } = serviceWith();
    expect(service.configured).toBe(true);

    const signed = await service.signedGetUrl(KEY, 120);
    const url = new URL(signed.url);
    expect(url.origin).toBe('https://api.example.com');
    expect(url.pathname).toBe('/api/v1/media/file');
    expect(url.searchParams.get('key')).toBe(KEY);
    expect(Number(url.searchParams.get('exp'))).toBeGreaterThan(Date.now() / 1000);

    const expected = createHmac('sha256', SECRET)
      .update(`${KEY}|${url.searchParams.get('exp')}`)
      .digest('hex');
    expect(url.searchParams.get('token')).toBe(expected);
    expect(() =>
      service.verifySignedUrl(
        KEY,
        url.searchParams.get('exp') ?? undefined,
        url.searchParams.get('token') ?? undefined,
      ),
    ).not.toThrow();
  });

  it('rejette un lien falsifié ou expiré', () => {
    const { service } = serviceWith();
    const now = Math.floor(Date.now() / 1000);
    const token = createHmac('sha256', SECRET).update(`${KEY}|${now}`).digest('hex');

    expect(() => service.verifySignedUrl(KEY, String(now), '0'.repeat(64))).toThrow(
      'Signature du lien invalide',
    );
    expect(() => service.verifySignedUrl('org/autre/fichier', String(now), token)).toThrow(
      'Signature du lien invalide',
    );

    const past = now - 120;
    const pastToken = createHmac('sha256', SECRET).update(`${KEY}|${past}`).digest('hex');
    expect(() => service.verifySignedUrl(KEY, String(past), pastToken)).toThrow('expiré');

    expect(() => service.verifySignedUrl('../secret', String(now), token)).toThrow('invalide');
  });

  it('écrit, relit et supprime les octets sans passer par un service externe', async () => {
    const { service, rows } = serviceWith();
    const content = Buffer.from('contenu binaire');

    await service.put(KEY, content, 'image/png');
    expect(rows.get(KEY)?.checksum).toBe(service.checksum(content));
    expect(rows.get(KEY)?.sizeBytes).toBe(content.length);

    const file = await service.read(KEY);
    expect(file?.content.equals(content)).toBe(true);
    expect(file?.mimeType).toBe('image/png');

    await service.remove(KEY);
    expect(await service.read(KEY)).toBeNull();
    await expect(service.remove(KEY)).resolves.toBeUndefined();
  });

  it('garde le pilote S3 désactivé sans configuration complète', async () => {
    const { service } = serviceWith({ MEDIA_STORAGE_DRIVER: 's3' });
    expect(service.configured).toBe(false);
    await expect(service.put(KEY, Buffer.from('x'), 'text/plain')).rejects.toThrow(
      'Stockage S3 non configuré',
    );
  });
});
