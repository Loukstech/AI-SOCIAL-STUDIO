import { describe, expect, it } from 'vitest';
import type { Db } from '../common/validation.js';
import { MediaController } from './media.controller.js';

type Row = {
  id: string;
  organizationId: string;
  brandId: string | null;
  name: string;
  kind: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sourceUrl: string | null;
  folder: string | null;
  tags: string[];
  favorite: boolean;
  checksum: string | null;
  rights: string | null;
  versionOfId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'media-1',
    organizationId: 'org-1',
    brandId: null,
    name: 'Visuel',
    kind: 'IMAGE',
    mimeType: null,
    sizeBytes: null,
    sourceUrl: null,
    folder: null,
    tags: [],
    favorite: false,
    checksum: null,
    rights: null,
    versionOfId: null,
    deletedAt: null,
    createdAt: new Date('2026-11-17T08:00:00Z'),
    ...overrides,
  };
}

function controllerWith(rows: Row[]) {
  let lastWhere: Record<string, unknown> = {};
  let lastData: Record<string, unknown> = {};
  const client = {
    mediaAsset: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        lastWhere = where;
        return rows.filter((item) =>
          Object.entries(where).every(([key, value]) => {
            if (value === undefined) return true;
            if (value && typeof value === 'object' && 'not' in value) {
              return (item as Record<string, unknown>)[key] !== (value as { not: unknown }).not;
            }
            return (item as Record<string, unknown>)[key] === value;
          }),
        );
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((item) =>
          Object.entries(where).every(([key, value]) =>
            value === undefined ? true : (item as Record<string, unknown>)[key] === value,
          ),
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        lastData = data;
        return row({ ...data, id: 'created' } as Partial<Row>);
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        lastData = data;
        return row({ ...data, id: 'updated' } as Partial<Row>);
      },
    },
    brand: { findFirst: async () => null },
  };
  const controller = new MediaController({ client } as unknown as Db);
  const auth = {
    auth: { userId: 'user-1', organizationId: 'org-1' },
  } as never;
  return { controller, auth, where: () => lastWhere, data: () => lastData };
}

describe('médiathèque (§12)', () => {
  it('filtre la recherche et les facettes en base', async () => {
    const env = controllerWith([]);
    await env.controller.list(env.auth, {
      search: 'campagne',
      kind: 'IMAGE',
      folder: 'campagnes',
      tag: 'été',
      favorite: 'true',
      limit: 20,
    });
    const where = env.where();
    expect(where.organizationId).toBe('org-1');
    expect(where.kind).toBe('IMAGE');
    expect(where.folder).toBe('campagnes');
    expect(where.favorite).toBe(true);
    expect(where.tags).toEqual({ has: 'été' });
    expect(where.OR).toHaveLength(3);
  });

  it('interprète un dossier vide comme la racine', async () => {
    const env = controllerWith([]);
    await env.controller.list(env.auth, { folder: '', limit: 100 });
    expect(env.where().folder).toBeNull();
  });

  it('ne signale que les empreintes réellement dupliquées', async () => {
    const env = controllerWith([
      row({ id: 'a', checksum: 'meme' }),
      row({ id: 'b', checksum: 'meme' }),
      row({ id: 'c', checksum: 'unique' }),
    ]);
    const groups = await env.controller.duplicates(env.auth);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.checksum).toBe('meme');
    expect(groups[0]!.assets.map((asset) => asset.id)).toEqual(['a', 'b']);
  });

  it('enregistre dossiers, tags, favori et empreinte', async () => {
    const env = controllerWith([]);
    await env.controller.create(env.auth, {
      name: 'Affiche',
      kind: 'LOGO',
      folder: 'marque',
      tags: ['validé'],
      favorite: true,
      checksum: 'abc',
      rights: 'Usage interne',
    });
    expect(env.data()).toMatchObject({
      kind: 'LOGO',
      folder: 'marque',
      tags: ['validé'],
      favorite: true,
      checksum: 'abc',
      rights: 'Usage interne',
    });
  });

  it('refuse une version d’origine d’une autre organisation', async () => {
    const env = controllerWith([row({ id: 'etranger', organizationId: 'org-2' })]);
    await expect(
      env.controller.create(env.auth, { name: 'V2', kind: 'IMAGE', versionOfId: 'etranger' }),
    ).rejects.toThrow('Version d’origine introuvable');
  });

  it('refuse qu’un média soit sa propre version', async () => {
    const env = controllerWith([row()]);
    await expect(
      env.controller.update(env.auth, 'media-1', { versionOfId: 'media-1' }),
    ).rejects.toThrow('sa propre version');
  });

  it('liste les versions du média demandé', async () => {
    const env = controllerWith([row(), row({ id: 'v1', versionOfId: 'media-1' })]);
    const versions = await env.controller.versions(env.auth, 'media-1');
    expect(versions).toHaveLength(1);
    expect(env.where()).toMatchObject({ organizationId: 'org-1', versionOfId: 'media-1' });
  });
});
