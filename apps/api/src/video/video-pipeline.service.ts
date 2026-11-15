import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  subtitleStyleSchema,
  transcriptSegmentSchema,
  transcriptStatusSchema,
  type SubtitleStyle,
  type SubtitleTrack,
  type Transcript,
} from '@ass/shared';
import { Db } from '../common/validation.js';
import { ENV, type Env } from '../config/env.js';
import { buildDemoSegments, countCues, toSrt } from './subtitles.js';

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  language: string;
}

/**
 * Pipeline vidéo : transcription puis génération de sous-titres.
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
    const content = toSrt(segments, style);
    const cueCount = countCues(segments, style);
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
        cueCount,
      },
      update: { content, cueCount },
    });
    return toTrack(row);
  }
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
