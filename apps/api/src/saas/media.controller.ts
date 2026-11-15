import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createMediaSchema,
  mediaAssetSchema,
  type CreateMediaInput,
  type MediaAsset,
} from '@ass/shared';
import { Db, ZodPipe } from '../common/validation.js';
import { AuthGuard, MinRole } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';

@Controller('media')
@UseGuards(AuthGuard)
export class MediaController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get()
  @MinRole('VIEWER')
  async list(@Req() request: AuthedRequest): Promise<MediaAsset[]> {
    const rows = await this.db.client.mediaAsset.findMany({
      where: { organizationId: this.org(request), deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(toMedia);
  }

  /**
   * Enregistre les métadonnées d'un média. Le fichier binaire sera déposé dans
   * un stockage objet (R2 / Supabase Storage) une fois celui-ci activé : cette
   * route accepte donc déjà une `sourceUrl` externe.
   */
  @Post()
  @MinRole('EDITOR')
  async create(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(createMediaSchema)) body: CreateMediaInput,
  ): Promise<MediaAsset> {
    if (body.brandId) {
      const brand = await this.db.client.brand.findFirst({
        where: { id: body.brandId, organizationId: this.org(request), deletedAt: null },
      });
      if (!brand) throw new NotFoundException('Marque introuvable');
    }
    const asset = await this.db.client.mediaAsset.create({
      data: { ...body, organizationId: this.org(request) },
    });
    return toMedia(asset);
  }

  @Delete(':id')
  @HttpCode(204)
  @MinRole('EDITOR')
  async remove(@Req() request: AuthedRequest, @Param('id') id: string): Promise<void> {
    const asset = await this.db.client.mediaAsset.findFirst({
      where: { id, organizationId: this.org(request), deletedAt: null },
    });
    if (!asset) throw new NotFoundException('Média introuvable');
    await this.db.client.mediaAsset.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private org(request: AuthedRequest): string {
    if (!request.auth?.organizationId) {
      throw new NotFoundException('Organisation active requise (X-Organization-Id)');
    }
    return request.auth.organizationId;
  }
}

function toMedia(row: {
  id: string;
  organizationId: string;
  brandId: string | null;
  name: string;
  kind: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sourceUrl: string | null;
  createdAt: Date;
}): MediaAsset {
  return {
    id: row.id,
    organizationId: row.organizationId,
    brandId: row.brandId,
    name: row.name,
    kind: mediaAssetSchema.shape.kind.parse(row.kind),
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sourceUrl: row.sourceUrl,
    createdAt: row.createdAt.toISOString(),
  };
}
