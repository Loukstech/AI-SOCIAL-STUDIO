import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  createImageProjectSchema,
  declineImageProjectSchema,
  updateImageProjectSchema,
  type CreateImageProjectInput,
  type DeclineImageProjectInput,
  type DeclineResult,
  type ImageProject,
  type ImageProjectDetail,
  type UpdateImageProjectInput,
} from '@ass/shared';
import { ZodPipe } from '../common/validation.js';
import { AuthGuard, MinRole } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';
import { ImageService } from './image.service.js';

/**
 * AI Image Studio (§7). Le visuel est produit localement, sans service externe.
 */
@Controller('image-projects')
@UseGuards(AuthGuard)
export class ImageProjectsController {
  constructor(@Inject(ImageService) private readonly images: ImageService) {}

  @Get()
  @MinRole('VIEWER')
  async list(@Req() request: AuthedRequest): Promise<ImageProject[]> {
    return this.images.list(this.org(request));
  }

  @Get(':id')
  @MinRole('VIEWER')
  async detail(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
  ): Promise<ImageProjectDetail> {
    return this.images.detail(this.org(request), id);
  }

  /** Téléchargement du SVG : le fichier est autonome, sans dépendance externe. */
  @Get(':id/download')
  @MinRole('VIEWER')
  @Header('Content-Type', 'image/svg+xml; charset=utf-8')
  async download(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const svg = await this.images.svgSource(this.org(request), id);
    response.setHeader('Content-Disposition', `attachment; filename="visuel-${id}.svg"`);
    return svg;
  }

  @Post()
  @HttpCode(201)
  @MinRole('EDITOR')
  async create(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(createImageProjectSchema)) body: CreateImageProjectInput,
  ): Promise<ImageProjectDetail> {
    return this.images.create(this.org(request), request.auth!.userId, body);
  }

  @Patch(':id')
  @MinRole('EDITOR')
  async update(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(updateImageProjectSchema)) body: UpdateImageProjectInput,
  ): Promise<ImageProjectDetail> {
    return this.images.update(this.org(request), id, body);
  }

  /** Nouveau décor, même contenu : seule la graine change. */
  @Post(':id/rerender')
  @HttpCode(200)
  @MinRole('EDITOR')
  async rerender(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
  ): Promise<ImageProjectDetail> {
    return this.images.rerender(this.org(request), id, request.auth!.userId);
  }

  /** Déclinaison dans d'autres gabarits, à calques de texte identiques. */
  @Post(':id/decline')
  @HttpCode(201)
  @MinRole('EDITOR')
  async decline(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(declineImageProjectSchema)) body: DeclineImageProjectInput,
  ): Promise<DeclineResult> {
    return this.images.decline(this.org(request), id, request.auth!.userId, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @MinRole('EDITOR')
  async remove(@Req() request: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.images.remove(this.org(request), id, request.auth!.userId);
  }

  private org(request: AuthedRequest): string {
    if (!request.auth?.organizationId) {
      throw new NotFoundException('Organisation active requise (X-Organization-Id)');
    }
    return request.auth.organizationId;
  }
}
