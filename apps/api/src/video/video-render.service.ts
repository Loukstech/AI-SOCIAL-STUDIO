import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RenderVideoInput, VideoRenderResult } from '@ass/shared';
import { render, type FfmpegRunner, type VideoFormat } from '@ass/worker-video';
import { Db } from '../common/validation.js';

/** Runner et disponibilité injectés : les tests ne dépendent pas de ffmpeg. */
export const VIDEO_RENDER_RUNNER = Symbol('VIDEO_RENDER_RUNNER');
export const VIDEO_FFMPEG_CHECK = Symbol('VIDEO_FFMPEG_CHECK');

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

    const sourcePath = this.sourceOf(project, input);
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

  private sourceOf(project: ProjectRow, input: RenderVideoInput): string {
    if (input.sourcePath) return resolve(input.sourcePath);
    if (project.sourceUrl?.startsWith('file://')) {
      try {
        return fileURLToPath(project.sourceUrl);
      } catch {
        throw new BadRequestException('URL file:// invalide');
      }
    }
    throw new BadRequestException(
      'Aucun fichier source local : fournir sourcePath ou une URL file:// sur le projet',
    );
  }
}
