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
  createBrandSchema,
  updateBrandSchema,
  type Brand,
  type BrandSocialLink,
  type CreateBrandInput,
  type UpdateBrandInput,
} from '@ass/shared';
import { Db, ZodPipe } from '../common/validation.js';
import { AuthGuard, MinRole } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';

/**
 * Marques et Brand Kit (§8).
 *
 * Les logos et images de référence sont stockés par identifiant de média :
 * le fichier d'origine n'est jamais copié ni réécrit. Une marque supprimée
 * reste référencée par les visuels qui l'ont utilisée (`onDelete: SetNull`).
 */
@Controller('brands')
@UseGuards(AuthGuard)
export class BrandsController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get()
  @MinRole('VIEWER')
  async list(@Req() request: AuthedRequest): Promise<Brand[]> {
    const rows = await this.db.client.brand.findMany({
      where: { organizationId: this.org(request), deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toBrand);
  }

  @Post()
  @MinRole('ADMIN')
  async create(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(createBrandSchema)) body: CreateBrandInput,
  ): Promise<Brand> {
    const organizationId = this.org(request);
    await this.assertMedia(organizationId, [
      body.logoPrimaryId,
      body.logoSecondaryId,
      ...(body.referenceImageIds ?? []),
    ]);

    const brand = await this.db.client.brand.create({
      data: {
        organizationId,
        name: body.name,
        ...(body.description ? { description: body.description } : {}),
        ...(body.primaryColor ? { primaryColor: body.primaryColor } : {}),
        ...(body.toneOfVoice ? { toneOfVoice: body.toneOfVoice } : {}),
        palette: body.palette ?? [],
        ...(body.logoPrimaryId ? { logoPrimaryId: body.logoPrimaryId } : {}),
        ...(body.logoSecondaryId ? { logoSecondaryId: body.logoSecondaryId } : {}),
        ...(body.headingFont ? { headingFont: body.headingFont } : {}),
        ...(body.bodyFont ? { bodyFont: body.bodyFont } : {}),
        ...(body.slogan ? { slogan: body.slogan } : {}),
        ...(body.website ? { website: body.website } : {}),
        ...(body.contactEmail ? { contactEmail: body.contactEmail } : {}),
        ...(body.contactPhone ? { contactPhone: body.contactPhone } : {}),
        ...(body.socialLinks ? { socialLinks: body.socialLinks } : {}),
        referenceImageIds: body.referenceImageIds ?? [],
        ...(body.editorialInstructions
          ? { editorialInstructions: body.editorialInstructions }
          : {}),
      },
    });

    await this.audit(request, organizationId, 'brand.created', brand.id);
    return toBrand(brand);
  }

  /** Mise à jour du kit. Les champs absents restent inchangés, `null` les vide. */
  @Patch(':id')
  @MinRole('ADMIN')
  async update(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(updateBrandSchema)) body: UpdateBrandInput,
  ): Promise<Brand> {
    const organizationId = this.org(request);
    const existing = await this.find(organizationId, id);
    await this.assertMedia(organizationId, [
      body.logoPrimaryId ?? undefined,
      body.logoSecondaryId ?? undefined,
      ...(body.referenceImageIds ?? []),
    ]);

    const brand = await this.db.client.brand.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.primaryColor !== undefined ? { primaryColor: body.primaryColor } : {}),
        ...(body.toneOfVoice !== undefined ? { toneOfVoice: body.toneOfVoice } : {}),
        ...(body.palette !== undefined ? { palette: body.palette } : {}),
        ...(body.logoPrimaryId !== undefined ? { logoPrimaryId: body.logoPrimaryId } : {}),
        ...(body.logoSecondaryId !== undefined ? { logoSecondaryId: body.logoSecondaryId } : {}),
        ...(body.headingFont !== undefined ? { headingFont: body.headingFont } : {}),
        ...(body.bodyFont !== undefined ? { bodyFont: body.bodyFont } : {}),
        ...(body.slogan !== undefined ? { slogan: body.slogan } : {}),
        ...(body.website !== undefined ? { website: body.website } : {}),
        ...(body.contactEmail !== undefined ? { contactEmail: body.contactEmail } : {}),
        ...(body.contactPhone !== undefined ? { contactPhone: body.contactPhone } : {}),
        ...(body.socialLinks !== undefined ? { socialLinks: body.socialLinks } : {}),
        ...(body.referenceImageIds !== undefined
          ? { referenceImageIds: body.referenceImageIds }
          : {}),
        ...(body.editorialInstructions !== undefined
          ? { editorialInstructions: body.editorialInstructions }
          : {}),
      },
    });

    await this.audit(request, organizationId, 'brand.updated', brand.id);
    return toBrand(brand);
  }

  @Delete(':id')
  @HttpCode(204)
  @MinRole('ADMIN')
  async remove(@Req() request: AuthedRequest, @Param('id') id: string): Promise<void> {
    const organizationId = this.org(request);
    const brand = await this.find(organizationId, id);
    await this.db.client.brand.update({ where: { id: brand.id }, data: { deletedAt: new Date() } });
    await this.audit(request, organizationId, 'brand.deleted', brand.id);
  }

  private async find(organizationId: string, id: string) {
    const brand = await this.db.client.brand.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!brand) throw new NotFoundException('Marque introuvable');
    return brand;
  }

  /** Un logo ou une référence doit appartenir à l'organisation. */
  private async assertMedia(organizationId: string, ids: Array<string | undefined>): Promise<void> {
    const wanted = [...new Set(ids.filter((value): value is string => Boolean(value)))];
    if (wanted.length === 0) return;
    const found = await this.db.client.mediaAsset.findMany({
      where: { id: { in: wanted }, organizationId, deletedAt: null },
      select: { id: true },
    });
    const missing = wanted.filter((id) => !found.some((row) => row.id === id));
    if (missing.length > 0) {
      throw new NotFoundException(`Média introuvable : ${missing.join(', ')}`);
    }
  }

  private async audit(
    request: AuthedRequest,
    organizationId: string,
    action: string,
    targetId: string,
  ): Promise<void> {
    await this.db.client.auditLog.create({
      data: {
        organizationId,
        actorId: request.auth!.userId,
        action,
        targetType: 'brand',
        targetId,
      },
    });
  }

  private org(request: AuthedRequest): string {
    if (!request.auth?.organizationId) {
      throw new NotFoundException('Organisation active requise (X-Organization-Id)');
    }
    return request.auth.organizationId;
  }
}

function toBrand(row: {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  primaryColor: string | null;
  toneOfVoice: string | null;
  palette: string[];
  logoPrimaryId: string | null;
  logoSecondaryId: string | null;
  headingFont: string | null;
  bodyFont: string | null;
  slogan: string | null;
  website: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  socialLinks: unknown;
  referenceImageIds: string[];
  editorialInstructions: string | null;
  createdAt: Date;
}): Brand {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    primaryColor: row.primaryColor,
    toneOfVoice: row.toneOfVoice,
    palette: row.palette,
    logoPrimaryId: row.logoPrimaryId,
    logoSecondaryId: row.logoSecondaryId,
    headingFont: row.headingFont,
    bodyFont: row.bodyFont,
    slogan: row.slogan,
    website: row.website,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    socialLinks: Array.isArray(row.socialLinks) ? (row.socialLinks as BrandSocialLink[]) : [],
    referenceImageIds: row.referenceImageIds,
    editorialInstructions: row.editorialInstructions,
    createdAt: row.createdAt.toISOString(),
  };
}
