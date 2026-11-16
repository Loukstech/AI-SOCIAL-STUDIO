import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export type VideoFormat = 'PORTRAIT' | 'SQUARE' | 'LANDSCAPE';

export interface Clip {
  start: number;
  end: number;
  label?: string;
}

export interface RenderJob {
  input: string;
  output: string;
  clips: Clip[];
  format?: VideoFormat;
  subtitles?: string;
}

export type FfmpegRunner = (args: string[]) => Promise<void>;

export const formatFilters: Record<VideoFormat, string> = {
  PORTRAIT: 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
  SQUARE: 'scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080',
  LANDSCAPE: 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080',
};

/** Échappe un chemin pour un filtre ffmpeg (`-vf subtitles=…`). */
export function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/** FFmpeg fourni avec le paquet, ou surcharge explicite par `FFMPEG_BIN`. */
export function resolveFfmpegPath(): string {
  if (process.env.FFMPEG_BIN) return process.env.FFMPEG_BIN;
  const require = createRequire(import.meta.url);
  const installer = require('@ffmpeg-installer/ffmpeg') as { path: string };
  return installer.path;
}

/** Lance ffmpeg et ne résout que sur un code de sortie nul. */
export function runFfmpeg(args: string[], binary = resolveFfmpegPath()): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      error = (error + chunk.toString()).slice(-4000);
    });
    child.on('error', rejectRun);
    child.on('close', (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`ffmpeg a échoué (code ${code}) : ${error.trim()}`));
    });
  });
}

/** Arguments d'un clip : coupe, recadrage au format, sous-titres éventuels. */
export function buildClipArgs(job: RenderJob, clip: Clip, outputPath: string): string[] {
  const format = job.format ?? 'PORTRAIT';
  const videoFilter = job.subtitles
    ? `${formatFilters[format]},subtitles='${escapeFilterPath(resolve(job.subtitles))}'`
    : formatFilters[format];

  return [
    '-y',
    '-ss',
    String(clip.start),
    '-i',
    job.input,
    '-t',
    String(clip.end - clip.start),
    '-vf',
    videoFilter,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    outputPath,
  ];
}

export function buildConcatArgs(listFile: string, output: string): string[] {
  return ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', output];
}

function validate(job: RenderJob): void {
  if (!job.clips.length) throw new Error('Aucun clip à rendre');
  for (const clip of job.clips) {
    if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.end <= clip.start) {
      throw new Error('Chaque clip doit avoir une fin strictement après son début');
    }
  }
}

/**
 * Rendu local : un fichier par clip, puis concaténation sans réencodage.
 *
 * Le LLM propose les temps de coupe ; ffmpeg les exécute. Aucune opération
 * déterministe n'est confiée à un modèle (§21).
 */
export async function render(job: RenderJob, runner: FfmpegRunner = runFfmpeg): Promise<string> {
  validate(job);
  const input = await stat(job.input);
  if (!input.isFile()) throw new Error('Le fichier source est introuvable');

  const output = resolve(job.output);
  await mkdir(dirname(output), { recursive: true });

  const temporary: string[] = [];
  const listFile = join(dirname(output), `.concat-${process.pid}-${Date.now()}.txt`);
  try {
    for (const [index, clip] of job.clips.entries()) {
      const clipPath = join(dirname(output), `.clip-${process.pid}-${index}.mp4`);
      await runner(buildClipArgs(job, clip, clipPath));
      temporary.push(clipPath);
    }

    const lines = temporary.map(
      (path) => `file '${path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`,
    );
    await writeFile(listFile, `${lines.join('\n')}\n`, 'utf8');
    await runner(buildConcatArgs(listFile, output));
    return output;
  } finally {
    await Promise.all([...temporary, listFile].map((path) => unlink(path).catch(() => undefined)));
  }
}
