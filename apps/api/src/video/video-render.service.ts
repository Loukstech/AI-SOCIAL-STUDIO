import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RenderVideoInput, VideoRenderResult } from '@ass/shared';
import { render, type FfmpegRunner, type VideoFormat } from '@ass/worker-video';
import { Db } from '../common/validation.js';

/** Runner et disponibilité injectés : les tests ne dépendent pas de ffmpeg. */
export const VIDEO_RENDER_RUNNER = Symbol('VIDEO_RENDER_RUNNER');
export const VIDEO_FFMPEG_CHECK = Symbol('VIDEO_FFMPEG_CHECK');
export const VIDEO_SOURCE_ROOT = Symbol('VIDEO_SOURCE_ROOT');

type ProjectRow = {
  id: string;
  sourceUrl: string | null;
};

type SubtitleRow = {
  id: string;
  content: string;
};

@Injectable()
export class VideoRenderService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(VIDEO_RENDER_RUNNER) private readonly runner: FfmpegRunner,
    @Inject(VIDEO_FFMPEG_CHECK) private readonly ffmpegAvailable: () => Promise<boolean>,
    @Inject(VIDEO_SOURCE_ROOT) private readonly sourceRoot: string,
  ) {}

  /**
   * Rend les clips retenus sur la machine qui exécute l'API.
   *
   * Aucun téléchargement n'est tenté : une URL http(s) sans `sourcePath` local
   * est refusée avec un motif explicite plutôt que de télécharger à l'aveugle.
   */
  async renderProject(
    organizationId: string,
    projectId: string,
    input: RenderVideoInput,
  ): Promise<VideoRenderResult> {
    const project = (await this.db.client.videoProject.findFirst({
      where: { id: projectId, organizationId, deletedAt: null },
      select: { id: true, sourceUrl: true },
    })) as ProjectRow | null;
    if (!project) throw new NotFoundException('Projet vidéo introuvable');

    const sourcePath = await this.sourceOf(project, input);
    try {
      if (!(await stat(sourcePath)).isFile()) throw new Error('pas un fichier');
    } catch {
      throw new BadRequestException('Fichier source introuvable sur cette machine');
    }

    if (!(await this.ffmpegAvailable())) {
      throw new ServiceUnavailableException('ffmpeg indisponible sur cette machine');
    }

    const name = input.outputName ?? `${project.id}-${Date.now()}.mp4`;
    const outputPath = resolve(join(process.cwd(), 'tmp', name));
    let subtitlePath: string | undefined;

    if (input.subtitleTrackId) {
      const track = (await this.db.client.subtitleTrack.findFirst({
        where: { id: input.subtitleTrackId, projectId, organizationId },
        select: { id: true, content: true },
      })) as SubtitleRow | null;
      if (!track) throw new NotFoundException('Piste de sous-titres introuvable');
      subtitlePath = resolve(join(process.cwd(), 'tmp', `${track.id}.srt`));
      await writeFile(subtitlePath, track.content, 'utf8');
    }

    try {
      await render(
        {
          input: sourcePath,
          output: outputPath,
          clips: input.clips,
          format: input.format as VideoFormat,
          ...(subtitlePath ? { subtitles: subtitlePath } : {}),
        },
        this.runner,
      );
    } finally {
      if (subtitlePath) await unlink(subtitlePath).catch(() => undefined);
    }

    return {
      projectId,
      outputPath,
      format: input.format,
      clips: input.clips.length,
      subtitlesApplied: Boolean(subtitlePath),
      worker: 'local-ffmpeg',
    };
  }

  /**
   * Résout la source puis vérifie qu'elle appartient réellement au dossier
   * autorisé. `relative` bloque `..`, `isAbsolute` bloque un chemin analogue,
   * et `realpath` empêche un lien symbolique de sortir de la racine.
   */
  private async sourceOf(project: ProjectRow, input: RenderVideoInput): Promise<string> {
    const root = resolve(this.sourceRoot);
    let candidate: string;
    if (input.sourcePath) {
      candidate = resolve(input.sourcePath);
    } else if (project.sourceUrl?.startsWith('file://')) {
      try {
        candidate = fileURLToPath(project.sourceUrl);
      } catch {
        throw new BadRequestException('URL file:// invalide');
      }
    } else {
      throw new BadRequestException(
        'Aucun fichier source local : fournir sourcePath ou une URL file:// sur le projet',
      );
    }

    const inside = (path: string, base: string): boolean => {
      const relation = relative(base, path);
      return relation !== '' && !relation.startsWith('..') && !isAbsolute(relation);
    };

    if (!inside(candidate, root)) {
      throw new BadRequestException('Fichier source hors du dossier autorisé');
    }

    let actual: string;
    try {
      actual = await realpath(candidate);
    } catch {
      throw new BadRequestException('Fichier source introuvable sur cette machine');
    }
    const actualRoot = await realpath(root).catch(() => root);
    if (!inside(actual, actualRoot)) {
      throw new BadRequestException('Fichier source hors du dossier autorisé');
    }
    return actual;
  }
}
