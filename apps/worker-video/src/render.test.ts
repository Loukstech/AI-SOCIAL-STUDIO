import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildClipArgs,
  buildConcatArgs,
  escapeFilterPath,
  render,
  resolveFfmpegPath,
  type RenderJob,
} from './render.js';

const job: RenderJob = {
  input: '/tmp/source.mp4',
  output: '/tmp/rendu.mp4',
  clips: [{ start: 3, end: 12, label: 'meilleur passage' }],
  format: 'PORTRAIT',
};

describe('worker ffmpeg (§22)', () => {
  it('recadre au format demandé sans étirer la vidéo', () => {
    const args = buildClipArgs(job, job.clips[0]!, '/tmp/clip.mp4');
    expect(args).toContain('scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920');
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2)).toEqual(['-ss', '3']);
    expect(args.slice(args.indexOf('-t'), args.indexOf('-t') + 2)).toEqual(['-t', '9']);
  });

  it('échappe un chemin de sous-titres dans le filtre', () => {
    expect(escapeFilterPath("C:\\vidéos\\a:b's.srt")).toBe("C\\:/vidéos/a\\:b\\'s.srt");
    const args = buildClipArgs(
      { ...job, subtitles: "C:\\vidéos\\a:b's.srt" },
      job.clips[0]!,
      '/tmp/clip.mp4',
    );
    expect(args.some((arg) => arg.includes("subtitles='C\\:/vidéos/a\\:b\\'s.srt'"))).toBe(true);
  });

  it('concatène sans réencodage', () => {
    expect(buildConcatArgs('/tmp/liste.txt', '/tmp/rendu.mp4')).toEqual([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      '/tmp/liste.txt',
      '-c',
      'copy',
      '/tmp/rendu.mp4',
    ]);
  });

  it('refuse une plage de coupe invalide avant de lancer ffmpeg', async () => {
    await expect(
      render({ ...job, clips: [{ start: 10, end: 5 }] }, async () => {
        throw new Error('ne doit pas être appelé');
      }),
    ).rejects.toThrow('strictement après son début');
  });

  it('rend chaque clip puis le fichier final, et nettoie les temporaires', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ass-worker-'));
    const input = join(directory, 'source.mp4');
    const output = join(directory, 'rendu.mp4');
    await writeFile(input, 'source');
    const calls: string[][] = [];

    try {
      const result = await render(
        {
          input,
          output,
          clips: [
            { start: 0, end: 2 },
            { start: 3, end: 5 },
          ],
          format: 'SQUARE',
        },
        async (args) => {
          calls.push(args);
          const target = args[args.length - 1]!;
          await writeFile(target, args.includes('concat') ? 'final' : 'clip');
        },
      );

      expect(result).toBe(output);
      expect(calls).toHaveLength(3);
      expect(calls[2]).toContain('-f');
      expect((await stat(output)).isFile()).toBe(true);
      expect((await readdir(directory)).sort()).toEqual(['rendu.mp4', 'source.mp4']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fournit un binaire ffmpeg exécutable', async () => {
    const binary = resolveFfmpegPath();
    expect((await stat(binary)).isFile()).toBe(true);
  });
});
