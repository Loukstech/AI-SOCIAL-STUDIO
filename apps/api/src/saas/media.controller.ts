import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  createMediaSchema,
  mediaAssetSchema,
  mediaDuplicateGroupSchema,
  mediaQuerySchema,
  mediaSignedUrlSchema,
  mediaUploadSchema,
  updateMediaSchema,
  type CreateMediaInput,
  type MediaAsset,
  type MediaDuplicateGroup,
  type MediaQuery,
  type MediaSignedUrl,
  type MediaUploadInput,
  type UpdateMediaInput,
} from '@ass/shared';
import { Db, ZodPipe } from '../common/validation.js';
import { AuthGuard, MinRole } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';
import { MAX_UPLOAD_BYTES, ObjectStorageService } from '../storage/object-storage.service.js';

@Controller('media')
@UseGuards(AuthGuard)
export class MediaController {
  private readonly logger = new Logger(MediaController.name);

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
  ) {}

  /** Recherche et filtres exécutés en base, jamais filtrés après coup à l'écran. */
  @Get()
  @MinRole('VIEWER')
  async list(
    @Req() request: AuthedRequest,
    @Query(new ZodPipe(mediaQuerySchema)) query: MediaQuery,
  ): Promise<MediaAsset[]> {
    const favorite =
      query.favorite === 'true' ? true : query.favorite === 'false' ? false : undefined;
    const rows = await this.db.client.mediaAsset.findMany({
      where: {
        organizationId: this.org(request),
        deletedAt: null,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.folder !== undefined
          ? { folder: query.folder === '' ? null : query.folder }
          : {}),
        ...(favorite !== undefined ? { favorite } : {}),
        ...(query.tag ? { tags: { has: query.tag } } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' as const } },
                { folder: { contains: query.search, mode: 'insensitive' as const } },
                { tags: { has: query.search } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return rows.map(toMedia);
  }

  /** Doublons réels : même empreinte déclarée, dans la même organisation. */
  @Get('duplicates')
  @MinRole('VIEWER')
  async duplicates(@Req() request: AuthedRequest): Promise<MediaDuplicateGroup[]> {
    const rows = await this.db.client.mediaAsset.findMany({
      where: {
        organizationId: this.org(request),
        deletedAt: null,
        checksum: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      take: 1000,
    });
    const groups = new Map<string, MediaAsset[]>();
    for (const row of rows) {
      if (!row.checksum) continue;
      const group = groups.get(row.checksum) ?? [];
      group.push(toMedia(row));
      groups.set(row.checksum, group);
    }
    return [...groups.entries()]
      .filter(([, assets]) => assets.length > 1)
      .map(([checksum, assets]) => mediaDuplicateGroupSchema.parse({ checksum, assets }));
  }

  /**
   * Enregistre les métadonnées d'un média. Le fichier binaire sera déposé dans
   * un stockage objet une fois celui-ci activé : cette route accepte déjà une
   * `sourceUrl` externe et une empreinte déclarée par le client.
   */
  @Post()
  @MinRole('EDITOR')
  async create(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(createMediaSchema)) body: CreateMediaInput,
  ): Promise<MediaAsset> {
    const organizationId = this.org(request);
    if (body.brandId) await this.assertBrand(organizationId, body.brandId);
    if (body.versionOfId) await this.assertVersion(organizationId, body.versionOfId);

    const asset = await this.db.client.mediaAsset.create({
      data: {
        name: body.name,
        kind: body.kind,
        organizationId,
        ...(body.mimeType ? { mimeType: body.mimeType } : {}),
        ...(body.sizeBytes !== undefined ? { sizeBytes: body.sizeBytes } : {}),
        ...(body.sourceUrl ? { sourceUrl: body.sourceUrl } : {}),
        ...(body.brandId ? { brandId: body.brandId } : {}),
        ...(body.folder ? { folder: body.folder } : {}),
        ...(body.tags ? { tags: body.tags } : {}),
        ...(body.favorite !== undefined ? { favorite: body.favorite } : {}),
        ...(body.checksum ? { checksum: body.checksum } : {}),
        ...(body.rights ? { rights: body.rights } : {}),
        ...(body.versionOfId ? { versionOfId: body.versionOfId } : {}),
      },
    });
    return toMedia(asset);
  }

  /**
   * Dépose le binaire dans le stockage objet puis enregistre sa référence.
   * Aucun octet du fichier n'est écrit en base.
   */
  @Post('upload')
  @MinRole('EDITOR')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  async upload(
    @Req() request: AuthedRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodPipe(mediaUploadSchema.default({}))) body: MediaUploadInput,
  ): Promise<MediaAsset> {
    if (!file) throw new BadRequestException('Fichier requis (champ « file »)');
    if (!this.storage.configured) {
      throw new ServiceUnavailableException('Stockage objet non configuré');
    }
    if (file.size > MAX_UPLOAD_BYTES || file.size === 0) {
      throw new BadRequestException('Fichier vide ou trop volumineux (25 Mo maximum)');
    }

    const organizationId = this.org(request);
    if (body.brandId) await this.assertBrand(organizationId, body.brandId);
    if (body.versionOfId) await this.assertVersion(organizationId, body.versionOfId);

    const id = randomUUID();
    const key = this.storage.objectKey(organizationId, file.originalname || 'fichier', id);
    const checksum = this.storage.checksum(file.buffer);
    const mimeType = file.mimetype || 'application/octet-stream';
    await this.storage.put(key, file.buffer, mimeType);

    try {
      const asset = await this.db.client.mediaAsset.create({
        data: {
          id,
          name: body.name || file.originalname || 'Média importé',
          kind: body.kind ?? inferKind(mimeType),
          organizationId,
          mimeType,
          sizeBytes: file.size,
          storageKey: key,
          checksum,
          ...(body.brandId ? { brandId: body.brandId } : {}),
          ...(body.folder ? { folder: body.folder } : {}),
          ...(body.tags ? { tags: splitTags(body.tags) } : {}),
          ...(body.rights ? { rights: body.rights } : {}),
          ...(body.versionOfId ? { versionOfId: body.versionOfId } : {}),
        },
      });
      return toMedia(asset);
    } catch (cause) {
      // Écriture en base refusée : on ne laisse pas d'objet orphelin.
      try {
        await this.storage.remove(key);
      } catch (cleanupError) {
        this.logger.warn(`Nettoyage objet impossible après échec DB : ${String(cleanupError)}`);
      }
      throw cause;
    }
  }

  /** URL signée de lecture, valable au maximum une heure. */
  @Get(':id/url')
  @MinRole('VIEWER')
  async signedUrl(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Query('expires') expires?: string,
  ): Promise<MediaSignedUrl> {
    const organizationId = this.org(request);
    const asset = await this.find(organizationId, id);
    if (!asset.storageKey) {
      throw new BadRequestException('Ce média ne possède pas de fichier stocké');
    }
    this.storage.assertOrganizationKey(organizationId, asset.storageKey);
    let seconds: number | undefined;
    if (expires !== undefined) {
      seconds = Number(expires);
      if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3600) {
        throw new BadRequestException('expires doit être compris entre 30 et 3600 secondes');
      }
    }
    const signed = await this.storage.signedGetUrl(asset.storageKey, seconds);
    return mediaSignedUrlSchema.parse(signed);
  }

  /** Métadonnées, dossier, tags, favori et lien de version. */
  @Patch(':id')
  @MinRole('EDITOR')
  async update(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(updateMediaSchema)) body: UpdateMediaInput,
  ): Promise<MediaAsset> {
    const organizationId = this.org(request);
    const existing = await this.find(organizationId, id);
    if (body.brandId) await this.assertBrand(organizationId, body.brandId);
    if (body.versionOfId) {
      if (body.versionOfId === id) {
        throw new BadRequestException('Un média ne peut pas être sa propre version');
      }
      await this.assertVersion(organizationId, body.versionOfId);
    }

    const updated = await this.db.client.mediaAsset.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.mimeType !== undefined ? { mimeType: body.mimeType } : {}),
        ...(body.sizeBytes !== undefined ? { sizeBytes: body.sizeBytes } : {}),
        ...(body.sourceUrl !== undefined ? { sourceUrl: body.sourceUrl } : {}),
        ...(body.brandId !== undefined ? { brandId: body.brandId } : {}),
        ...(body.folder !== undefined ? { folder: body.folder } : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
        ...(body.favorite !== undefined ? { favorite: body.favorite } : {}),
        ...(body.checksum !== undefined ? { checksum: body.checksum } : {}),
        ...(body.rights !== undefined ? { rights: body.rights } : {}),
        ...(body.versionOfId !== undefined ? { versionOfId: body.versionOfId } : {}),
      },
    });
    return toMedia(updated);
  }

  @Get(':id/versions')
  @MinRole('VIEWER')
  async versions(@Req() request: AuthedRequest, @Param('id') id: string): Promise<MediaAsset[]> {
    const organizationId = this.org(request);
    await this.find(organizationId, id);
    const rows = await this.db.client.mediaAsset.findMany({
      where: { organizationId, versionOfId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toMedia);
  }

  @Delete(':id')
  @HttpCode(204)
  @MinRole('EDITOR')
  async remove(@Req() request: AuthedRequest, @Param('id') id: string): Promise<void> {
    const asset = await this.find(this.org(request), id);
    await this.db.client.mediaAsset.update({
      where: { id: asset.id },
      data: { deletedAt: new Date() },
    });
    if (asset.storageKey && this.storage.configured) {
      try {
        await this.storage.remove(asset.storageKey);
      } catch (cause) {
        // Le média est déjà masqué : un objet restant n'est plus accessible.
        this.logger.warn(`Objet non supprimé pour ${asset.id} : ${String(cause)}`);
      }
    }
  }

  private org(request: AuthedRequest): string {
    if (!request.auth?.organizationId) {
      throw new NotFoundException('Organisation active requise (X-Organization-Id)');
    }
    return request.auth.organizationId;
  }

  private async find(organizationId: string, id: string) {
    const asset = await this.db.client.mediaAsset.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!asset) throw new NotFoundException('Média introuvable');
    return asset;
  }

  private async assertBrand(organizationId: string, brandId: string): Promise<void> {
    const brand = await this.db.client.brand.findFirst({
      where: { id: brandId, organizationId, deletedAt: null },
    });
    if (!brand) throw new NotFoundException('Marque introuvable');
  }

  private async assertVersion(organizationId: string, versionOfId: string): Promise<void> {
    const original = await this.db.client.mediaAsset.findFirst({
      where: { id: versionOfId, organizationId, deletedAt: null },
    });
    if (!original) throw new NotFoundException('Version d’origine introuvable');
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
  storageKey: string | null;
  folder: string | null;
  tags: string[];
  favorite: boolean;
  checksum: string | null;
  rights: string | null;
  versionOfId: string | null;
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
    hasFile: Boolean(row.storageKey),
    folder: row.folder,
    tags: row.tags ?? [],
    favorite: row.favorite,
    checksum: row.checksum,
    rights: row.rights,
    versionOfId: row.versionOfId,
    createdAt: row.createdAt.toISOString(),
  };
}

function inferKind(mimeType: string): 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' {
  if (mimeType.startsWith('image/')) return 'IMAGE';
  if (mimeType.startsWith('video/')) return 'VIDEO';
  if (mimeType.startsWith('audio/')) return 'AUDIO';
  return 'DOCUMENT';
}

/** Tags envoyés en multipart sous forme de chaîne séparée par des virgules. */
function splitTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 20),
    ),
  ];
}
