import { Controller, Get, Query, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { ObjectStorageService } from '../storage/object-storage.service.js';

/**
 * Sert les binaires privés de la médiathèque via une URL signée HMAC (§12).
 * Aucun jeton de session n'est exigé ici : le lien court-circuit est la seule
 * autorisation, il est signé par l'API et expire au plus tard après une heure.
 */
@Controller('media/file')
export class MediaFileController {
  constructor(private readonly storage: ObjectStorageService) {}

  @Get()
  async download(
    @Query('key') key: string | undefined,
    @Query('exp') exp: string | undefined,
    @Query('token') token: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    this.storage.verifySignedUrl(key, exp, token);

    const file = await this.storage.read(key!);
    if (!file) throw new UnauthorizedException('Fichier introuvable');

    const filename = key!.split('/').pop() || 'fichier';
    response.status(200);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.content.length));
    response.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, max-age=60');
    response.end(file.content);
  }
}
