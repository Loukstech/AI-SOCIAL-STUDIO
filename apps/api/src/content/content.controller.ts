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
  generateContentSchema,
  rewriteVariantSchema,
  updateVariantSchema,
  type ContentProject,
  type ContentProjectDetail,
  type GenerateContentInput,
  type RewriteVariantInput,
  type UpdateVariantInput,
} from '@ass/shared';
import { Db, ZodPipe } from '../common/validation.js';
import { AuthGuard, MinRole } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';
import { ContentService } from './content.service.js';

/**
 * AI Content Studio — routes du cahier des charges §20 :
 * `POST /ai/content/generate` puis le CRUD sous `/content`.
 */

@Controller('ai/content')
@UseGuards(AuthGuard)
export class ContentGenerationController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ContentService) private readonly content: ContentService,
  ) {}

  @Post('generate')
  @HttpCode(201)
  @MinRole('EDITOR')
  async generate(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(generateContentSchema)) body: GenerateContentInput,
  ): Promise<ContentProjectDetail> {
    const organizationId = this.org(request);
    const brandName = body.brandId ? await this.brandName(organizationId, body.brandId) : null;
    const project = await this.content.generate(organizationId, body, brandName);

    await this.audit(request, organizationId, 'content.generated', project.id, {
      platforms: body.platforms.length,
      contentType: body.contentType,
      tone: body.tone,
    });
    return project;
  }

  private org(request: AuthedRequest): string {
    if (!request.auth?.organizationId) {
      throw new NotFoundException('Organisation active requise (X-Organization-Id)');
    }
    return request.auth.organizationId;
  }

  private async brandName(organizationId: string, brandId: string): Promise<string> {
    const brand = await this.db.client.brand.findFirst({
      where: { id: brandId, organizationId, deletedAt: null },
      select: { name: true },
    });
    if (!brand) throw new NotFoundException('Marque introuvable');
    return brand.name;
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
        targetType: 'content_project',
        targetId,
        ...(metadata ? { metadata } : {}),
      },
    });
  }
}

@Controller('content')
@UseGuards(AuthGuard)
export class ContentController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ContentService) private readonly content: ContentService,
  ) {}

  @Get()
  @MinRole('VIEWER')
  async list(@Req() request: AuthedRequest): Promise<ContentProject[]> {
    return this.content.list(this.org(request));
  }

  @Get(':id')
  @MinRole('VIEWER')
  async detail(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
  ): Promise<ContentProjectDetail> {
    return this.content.detail(this.org(request), id);
  }

  @Patch(':id/variants/:variantId')
  @MinRole('EDITOR')
  async updateVariant(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body(new ZodPipe(updateVariantSchema)) body: UpdateVariantInput,
  ): Promise<ContentProjectDetail> {
    const organizationId = this.org(request);
    const detail = await this.content.updateVariant(organizationId, id, variantId, body);
    await this.audit(request, organizationId, 'content.variant_updated', id, { variantId });
    return detail;
  }

  @Post(':id/variants/:variantId/rewrite')
  @HttpCode(200)
  @MinRole('EDITOR')
  async rewrite(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body(new ZodPipe(rewriteVariantSchema)) body: RewriteVariantInput,
  ): Promise<ContentProjectDetail> {
    const organizationId = this.org(request);
    const detail = await this.content.rewrite(organizationId, id, variantId, body);
    await this.audit(request, organizationId, 'content.variant_rewritten', id, {
      action: body.action,
      variantId,
    });
    return detail;
  }

  @Delete(':id')
  @HttpCode(204)
  @MinRole('EDITOR')
  async remove(@Req() request: AuthedRequest, @Param('id') id: string): Promise<void> {
    const organizationId = this.org(request);
    await this.content.remove(organizationId, id);
    await this.audit(request, organizationId, 'content.deleted', id, null);
  }

  private org(request: AuthedRequest): string {
    if (!request.auth?.organizationId) {
      throw new NotFoundException('Organisation active requise (X-Organization-Id)');
    }
    return request.auth.organizationId;
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
        targetType: 'content_project',
        targetId,
        ...(metadata ? { metadata } : {}),
      },
    });
  }
}
