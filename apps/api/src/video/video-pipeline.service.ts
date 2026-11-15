import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  subtitleStyleSchema,
  transcriptSegmentSchema,
  transcriptStatusSchema,
  type ClipSuggestion,
  type SubtitleFormat,
  type SubtitleStyle,
  type SubtitleTrack,
  type Transcript,
  type TranscriptSegment,
} from '@ass/shared';
import { Db } from '../common/validation.js';
import { ENV, type Env } from '../config/env.js';
import { suggestClips } from './clips.js';
import { buildDemoSegments, serializeCues, splitIntoCues } from './subtitles.js';

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  language: string;
}

/**
 * Pipeline vidéo : transcription, édition, sous-titres et extraction de clips.
 *
 * La frontière fournisseur est explicite : seul `mock` est implémenté. Brancher
 * OpenAI (ou un autre) consiste à ajouter un fournisseur ici, sans toucher aux
 * contrôleurs ni à l'interface.
 */
@Injectable()
export class VideoPipelineService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async transcribe(project: ProjectRow): Promise<Transcript> {
    if (this.env.AI_PROVIDER !== 'mock') {
      throw new ServiceUnavailableException(
        `Fournisseur IA « ${this.env.AI_PROVIDER} » non disponible : seule la démonstration locale (AI_PROVIDER=mock) est active.`,
      );
    }

    const segments = buildDemoSegments({
      name: project.name,
      description: project.description,
    });
    const text = segments.map((segment) => segment.text).join(' ');
    const durationSeconds = Math.ceil(segments.at(-1)?.end ?? 0);

    const row = await this.db.client.transcript.upsert({
      where: { projectId: project.id },
      create: {
        projectId: project.id,
        status: 'COMPLETED',
        language: project.language,
        provider: 'mock',
        text,
        segments,
      },
      update: {
        status: 'COMPLETED',
        language: project.language,
        provider: 'mock',
        text,
        segments,
        error: null,
      },
    });
    await this.db.client.videoProject.update({
      where: { id: project.id },
      data: { status: 'TRANSCRIBED', durationSeconds },
    });
    return toTranscript(row);
  }

  /**
   * Édition manuelle de la transcription (§5.3).
   *
   * Les segments fournis remplacent les précédents. Les pistes de sous-titres
   * étant des artefacts dérivés, elles sont supprimées : conserver des cues
   * calculées sur un texte qui n'existe plus serait trompeur.
   */
  async updateTranscript(project: ProjectRow, segments: TranscriptSegment[]): Promise<Transcript> {
    const transcript = await this.db.client.transcript.findUnique({
      where: { projectId: project.id },
    });
    if (!transcript) {
      throw new BadRequestException('Transcrivez la vidéo avant de modifier la transcription');
    }

    assertValidSegments(segments);

    const text = segments.map((segment) => segment.text).join(' ');
    const row = await this.db.client.transcript.update({
      where: { projectId: project.id },
      data: { segments, text },
    });
    await this.db.client.subtitleTrack.deleteMany({ where: { projectId: project.id } });
    await this.db.client.videoProject.update({
      where: { id: project.id },
      data: {
        status: 'TRANSCRIBED',
        durationSeconds: Math.ceil(segments.at(-1)?.end ?? 0),
      },
    });
    return toTranscript(row);
  }

  async generateSubtitles(
    project: ProjectRow,
    style: SubtitleStyle,
    language?: string,
  ): Promise<SubtitleTrack> {
    const transcript = await this.db.client.transcript.findUnique({
      where: { projectId: project.id },
    });
    if (!transcript || transcript.status !== 'COMPLETED') {
      throw new BadRequestException(
        'Transcrivez d’abord la vidéo : les sous-titres sont générés à partir de la transcription',
      );
    }

    const segments = transcriptSegmentSchema.array().parse(transcript.segments ?? []);
    const cues = splitIntoCues(segments, style);
    const content = serializeCues(cues, 'srt');
    const targetLanguage = language ?? transcript.language;

    const row = await this.db.client.subtitleTrack.upsert({
      where: {
        projectId_style_language: {
          projectId: project.id,
          style,
          language: targetLanguage,
        },
      },
      create: {
        projectId: project.id,
        style,
        language: targetLanguage,
        content,
        cueCount: cues.length,
        cues,
      },
      update: { content, cueCount: cues.length, cues },
    });
    return toTrack(row);
  }

  /** Export d'une piste dans un autre format (§5.3 et §5.8). */
  async exportTrack(
    project: ProjectRow,
    trackId: string,
    format: SubtitleFormat,
  ): Promise<{ filename: string; content: string }> {
    const track = await this.db.client.subtitleTrack.findFirst({
      where: { id: trackId, projectId: project.id },
    });
    if (!track) throw new NotFoundException('Piste de sous-titres introuvable');

    let cues = track.cues ? transcriptSegmentSchema.array().parse(track.cues) : null;

    // Piste héritée d'avant l'ajout de `cues` : on recalcule depuis la transcription.
    if (!cues) {
      const transcript = await this.db.client.transcript.findUnique({
        where: { projectId: project.id },
      });
      const segments = transcriptSegmentSchema.array().parse(transcript?.segments ?? []);
      cues = splitIntoCues(segments, subtitleStyleSchema.parse(track.style));
    }

    const slug = project.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);

    return {
      filename: `${slug || 'projet'}.${track.style.toLowerCase()}.${track.language}.${format}`,
      content: serializeCues(cues, format),
    };
  }

  /** Mode A : propose des clips à partir de la transcription, et remplace les précédents. */
  async extractClips(project: ProjectRow, targetDuration: number): Promise<ClipSuggestion[]> {
    const transcript = await this.db.client.transcript.findUnique({
      where: { projectId: project.id },
    });
    if (!transcript || transcript.status !== 'COMPLETED') {
      throw new BadRequestException(
        'Transcrivez d’abord la vidéo : les clips sont extraits de la transcription',
      );
    }

    const segments = transcriptSegmentSchema.array().parse(transcript.segments ?? []);
    const drafts = suggestClips(segments, targetDuration);
    if (drafts.length === 0) {
      throw new BadRequestException('Transcription vide : aucun clip ne peut être proposé');
    }

    await this.db.client.clipSuggestion.deleteMany({ where: { projectId: project.id } });
    await this.db.client.clipSuggestion.createMany({
      data: drafts.map((draft) => ({ ...draft, projectId: project.id })),
    });

    const rows = await this.db.client.clipSuggestion.findMany({
      where: { projectId: project.id },
      orderBy: [{ score: 'desc' }, { start: 'asc' }],
    });
    return rows.map(toClip);
  }
}

/** Une transcription éditée doit rester lisible : ordre, bornes et texte non vide. */
export function assertValidSegments(segments: TranscriptSegment[]): void {
  segments.forEach((segment, index) => {
    if (segment.end <= segment.start) {
      throw new BadRequestException(`Segment ${index + 1} : la fin doit être postérieure au début`);
    }
    if (!segment.text.trim()) {
      throw new BadRequestException(`Segment ${index + 1} : le texte ne peut pas être vide`);
    }
    const previous = segments[index - 1];
    if (previous && segment.start < previous.start) {
      throw new BadRequestException(`Segment ${index + 1} : les segments doivent être ordonnés`);
    }
  });
}

export function toTranscript(row: {
  id: string;
  projectId: string;
  status: string;
  language: string;
  provider: string | null;
  text: string | null;
  segments: unknown;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Transcript {
  return {
    id: row.id,
    projectId: row.projectId,
    status: transcriptStatusSchema.parse(row.status),
    language: row.language,
    provider: row.provider,
    text: row.text,
    segments: transcriptSegmentSchema.array().parse(row.segments ?? []),
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toTrack(row: {
  id: string;
  projectId: string;
  style: string;
  language: string;
  content: string;
  cueCount: number;
  createdAt: Date;
  updatedAt: Date;
}): SubtitleTrack {
  return {
    id: row.id,
    projectId: row.projectId,
    style: subtitleStyleSchema.parse(row.style),
    language: row.language,
    content: row.content,
    cueCount: row.cueCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toClip(row: {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  start: number;
  end: number;
  duration: number;
  score: number;
  rationale: string;
  selected: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ClipSuggestion {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    summary: row.summary,
    start: row.start,
    end: row.end,
    duration: row.duration,
    score: row.score,
    rationale: row.rationale,
    selected: row.selected,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
