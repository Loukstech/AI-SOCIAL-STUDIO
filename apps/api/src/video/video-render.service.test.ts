import { mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RenderVideoInput } from '@ass/shared';
import type { Db } from '../common/validation.js';
import { VideoRenderService } from './video-render.service.js';

const input: RenderVideoInput = {
  clips: [{ start: 0, end: 2 }],
  format: 'SQUARE',
  outputName: 'test-render.mp4',
};

describe('rendu vidéo via l’API (§22)', () => {
  let directory: string;
  let source: string;
  let calls: string[][];
  let available: boolean;
  let service: VideoRenderService;
  let track: { id: string; content: string } | null;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ass-api-render-'));
    source = join(directory, 'source.mp4');
    await writeFile(source, 'source');
    calls = [];
    available = true;
    track = null;

    const client = {
      videoProject: {
        findFirst: async ({ where }: { where: { id: string; organizationId: string } }) =>
          where.id === 'project-1' && where.organizationId === 'org-1'
            ? { id: 'project-1', sourceUrl: pathToFileURL(source).toString() }
            : null,
      },
      subtitleTrack: {
        findFirst: async () => track,
      },
    };

    service = new VideoRenderService(
      { client } as unknown as Db,
      async (args) => {
        calls.push(args);
        await writeFile(args[args.length - 1]!, 'rendu');
      },
      async () => available,
    );
  });

  afterEach(async () => {
    await unlink(join(process.cwd(), 'tmp', 'test-render.mp4')).catch(() => undefined);
    await unlink(join(process.cwd(), 'tmp', 'track-1.srt')).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  });

  it('rend un projet depuis son URL file://', async () => {
    const result = await service.renderProject('org-1', 'project-1', {
      ...input,
      sourcePath: undefined,
    });

    expect(result.worker).toBe('local-ffmpeg');
    expect(result.format).toBe('SQUARE');
    expect(result.clips).toBe(1);
    expect(result.subtitlesApplied).toBe(false);
    expect(calls).toHaveLength(2);
    expect((await stat(result.outputPath)).isFile()).toBe(true);
  });

  it('écrit une piste SRT temporaire et la retire après le rendu', async () => {
    track = { id: 'track-1', content: '1\n00:00:00,000 --> 00:00:01,000\nBonjour\n' };
    const result = await service.renderProject('org-1', 'project-1', {
      ...input,
      subtitleTrackId: 'track-1',
    });

    expect(result.subtitlesApplied).toBe(true);
    const subtitleArg = calls[0]?.find((arg) => arg.includes('subtitles='));
    expect(subtitleArg).toContain('track-1.srt');
    await expect(stat(join(process.cwd(), 'tmp', 'track-1.srt'))).rejects.toThrow();
  });

  it('refuse une URL distante sans fichier local', async () => {
    await expect(
      service.renderProject('org-1', 'project-1', { ...input, sourcePath: undefined }),
    ).resolves.toBeTruthy();

    const client = {
      videoProject: {
        findFirst: async () => ({
          id: 'project-1',
          sourceUrl: 'https://exemple.test/video.mp4',
        }),
      },
    };
    const remote = new VideoRenderService(
      { client } as unknown as Db,
      async () => undefined,
      async () => true,
    );
    await expect(
      remote.renderProject('org-1', 'project-1', { ...input, sourcePath: undefined }),
    ).rejects.toThrow('Aucun fichier source local');
  });

  it('signale un projet introuvable', async () => {
    await expect(
      service.renderProject('org-1', 'inconnu', {
        ...input,
        sourcePath: source,
      }),
    ).rejects.toThrow('Projet vidéo introuvable');
  });

  it('renvoie 503 si ffmpeg est indisponible', async () => {
    available = false;
    await expect(service.renderProject('org-1', 'project-1', { ...input })).rejects.toThrow(
      'ffmpeg indisponible',
    );
  });

  it('vérifie le contrat de résultat partagé', async () => {
    const result = await service.renderProject('org-1', 'project-1', { ...input });
    expect(Object.keys(result).sort()).toEqual([
      'clips',
      'format',
      'outputPath',
      'projectId',
      'subtitlesApplied',
      'worker',
    ]);
    expect((await readFile(result.outputPath, 'utf8')).toString()).toBe('rendu');
  });
});
