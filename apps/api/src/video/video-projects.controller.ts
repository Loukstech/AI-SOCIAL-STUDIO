import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createSubtitleSchema,
  createVideoProjectSchema,
  transcriptStatusSchema,
  updateVideoProjectSchema,
  videoProjectStatusSchema,
  type CreateSubtitleInput,
  type CreateVideoProjectInput,
  type SubtitleTrack,
  type UpdateVideoProjectInput,
  type VideoProject,
  type VideoProjectDetail,
} from '@ass/shared';
import { Db, ZodPipe } from '../common/validation.js';
import { AuthGuard, MinRole } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';
import { VideoPipelineService, toTrack, toTranscript } from './video-pipeline.service.js';

@Controller('video-projects')
@UseGuards(AuthGuard)
export class VideoProjectsController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(VideoPipelineService) private readonly pipeline: VideoPipelineService,
  ) {}

  @Get()
  @MinRole('VIEWER')
  async list(@Req() request: AuthedRequest): Promise<VideoProject[]> {
    const rows = await this.db.client.videoProject.findMany({
      where: { organizationId: this.org(request), deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        transcript: { select: { status: true } },
        _count: { select: { subtitles: true } },
      },
    });
    return rows.map((row) => toProject(row, row.transcript?.status ?? null, row._count.subtitles));
  }

  @Post()
  @MinRole('EDITOR')
  async create(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(createVideoProjectSchema)) body: CreateVideoProjectInput,
  ): Promise<VideoProject> {
    const organizationId = this.org(request);
    if (body.brandId) await this.assertBrand(organizationId, body.brandId);

    const project = await this.db.client.videoProject.create({
      data: {
        organizationId,
        name: body.name,
        language: body.language ?? 'fr',
        ...(body.description ? { description: body.description } : {}),
        ...(body.sourceUrl ? { sourceUrl: body.sourceUrl } : {}),
        ...(body.brandId ? { brandId: body.brandId } : {}),
      },
    });
    await this.audit(request, organizationId, 'video_project.created', project.id, {
      name: project.name,
    });
    return toProject(project, null, 0);
  }

  @Get(':id')
  @MinRole('VIEWER')
  async detail(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
  ): Promise<VideoProjectDetail> {
    return this.detailOf(this.org(request), id);
  }

  @Patch(':id')
  @MinRole('EDITOR')
  async update(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(updateVideoProjectSchema)) body: UpdateVideoProjectInput,
  ): Promise<VideoProjectDetail> {
    const organizationId = this.org(request);
    const project = await this.find(organizationId, id);
    if (body.brandId) await this.assertBrand(organizationId, body.brandId);

    await this.db.client.videoProject.update({
      where: { id: project.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.sourceUrl !== undefined ? { sourceUrl: body.sourceUrl } : {}),
        ...(body.brandId !== undefined ? { brandId: body.brandId } : {}),
        ...(body.language ? { language: body.language } : {}),
      },
    });
    await this.audit(request, organizationId, 'video_project.updated', project.id, null);
    return this.detailOf(organizationId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @MinRole('EDITOR')
  async remove(@Req() request: AuthedRequest, @Param('id') id: string): Promise<void> {
    const organizationId = this.org(request);
    const project = await this.find(organizationId, id);
    await this.db.client.videoProject.update({
      where: { id: project.id },
      data: { deletedAt: new Date() },
    });
    await this.audit(request, organizationId, 'video_project.deleted', project.id, {
      name: project.name,
    });
  }

  @Post(':id/transcribe')
  @HttpCode(200)
  @MinRole('EDITOR')
  async transcribe(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
  ): Promise<VideoProjectDetail> {
    const organizationId = this.org(request);
    const project = await this.find(organizationId, id);
    const transcript = await this.pipeline.transcribe(project);
    await this.audit(request, organizationId, 'video_project.transcribed', project.id, {
      provider: transcript.provider ?? 'mock',
    });
    return this.detailOf(organizationId, id);
  }

  @Post(':id/subtitles')
  @HttpCode(201)
  @MinRole('EDITOR')
  async subtitles(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(createSubtitleSchema)) body: CreateSubtitleInput,
  ): Promise<SubtitleTrack> {
    const organizationId = this.org(request);
    const project = await this.find(organizationId, id);
    const track = await this.pipeline.generateSubtitles(project, body.style, body.language);
    await this.audit(request, organizationId, 'video_project.subtitles_generated', project.id, {
      style: track.style,
      cues: track.cueCount,
    });
    return track;
  }

  private org(request: AuthedRequest): string {
    if (!request.auth?.organizationId) {
      throw new NotFoundException('Organisation active requise (X-Organization-Id)');
    }
    return request.auth.organizationId;
  }

  private async find(organizationId: string, id: string) {
    const project = await this.db.client.videoProject.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!project) throw new NotFoundException('Projet vidéo introuvable');
    return project;
  }

  private async detailOf(organizationId: string, id: string): Promise<VideoProjectDetail> {
    const row = await this.db.client.videoProject.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        transcript: true,
        subtitles: { orderBy: { createdAt: 'asc' } },
        _count: { select: { subtitles: true } },
      },
    });
    if (!row) throw new NotFoundException('Projet vidéo introuvable');
    return {
      ...toProject(row, row.transcript?.status ?? null, row._count.subtitles),
      transcript: row.transcript ? toTranscript(row.transcript) : null,
      subtitles: row.subtitles.map(toTrack),
    };
  }

  private async assertBrand(organizationId: string, brandId: string): Promise<void> {
    const brand = await this.db.client.brand.findFirst({
      where: { id: brandId, organizationId, deletedAt: null },
    });
    if (!brand) throw new NotFoundException('Marque introuvable');
  }

  private async audit(
    request: AuthedRequest,
    organizationId: string,
    action: string,
    targetId: string,
    metadata: Record<string, string | number> | null,
  ): Promise<void> {
    await this.db.client.auditLog.create({
      data: {
        organizationId,
        actorId: request.auth!.userId,
        action,
        targetType: 'video_project',
        targetId,
        ...(metadata ? { metadata } : {}),
      },
    });
  }
}

function toProject(
  row: {
    id: string;
    organizationId: string;
    brandId: string | null;
    name: string;
    description: string | null;
    sourceUrl: string | null;
    language: string;
    durationSeconds: number | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  },
  transcriptStatus: string | null,
  subtitleCount: number,
): VideoProject {
  return {
    id: row.id,
    organizationId: row.organizationId,
    brandId: row.brandId,
    name: row.name,
    description: row.description,
    sourceUrl: row.sourceUrl,
    language: row.language,
    durationSeconds: row.durationSeconds,
    status: videoProjectStatusSchema.parse(row.status),
    transcriptStatus: transcriptStatus ? transcriptStatusSchema.parse(transcriptStatus) : null,
    subtitleCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
