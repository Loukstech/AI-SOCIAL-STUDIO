import {
  BadRequestException,
  Body,
  ConflictException,
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
  connectRequestSchema,
  createSocialAccountSchema,
  socialAccountStatusSchema,
  socialPlatformSchema,
  updateSocialAccountSchema,
  type ConnectRequestInput,
  type ConnectResult,
  type ConnectionHealth,
  type CreateSocialAccountInput,
  type SocialAccount,
  type UpdateSocialAccountInput,
} from '@ass/shared';
import { Db, ZodPipe } from '../common/validation.js';
import { AuthGuard, MinRole } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';
import { ENV, type Env } from '../config/env.js';
import { encryptSecret } from '../auth/crypto.js';
import { OAuthService } from '../social/oauth.service.js';

@Controller('social-accounts')
@UseGuards(AuthGuard)
export class SocialAccountsController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(OAuthService) private readonly oauth: OAuthService,
  ) {}

  @Get()
  @MinRole('VIEWER')
  async list(@Req() request: AuthedRequest): Promise<SocialAccount[]> {
    const rows = await this.db.client.socialAccount.findMany({
      where: { organizationId: this.org(request), deletedAt: null },
      orderBy: [{ platform: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toSocialAccount);
  }

  @Post()
  @MinRole('ADMIN')
  async create(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(createSocialAccountSchema)) body: CreateSocialAccountInput,
  ): Promise<SocialAccount> {
    const organizationId = this.org(request);
    if (body.brandId) await this.assertBrand(organizationId, body.brandId);
    const secret = this.secret();

    try {
      const account = await this.db.client.socialAccount.create({
        data: {
          organizationId,
          platform: body.platform,
          username: body.username,
          status: body.accessToken ? 'CONNECTED' : 'EXPIRED',
          scopes: body.scopes ?? [],
          ...(body.displayName ? { displayName: body.displayName } : {}),
          ...(body.brandId ? { brandId: body.brandId } : {}),
          ...(body.accessToken ? { accessToken: encryptSecret(body.accessToken, secret) } : {}),
          ...(body.refreshToken ? { refreshToken: encryptSecret(body.refreshToken, secret) } : {}),
          ...(body.tokenExpiresAt ? { tokenExpiresAt: new Date(body.tokenExpiresAt) } : {}),
        },
      });
      await this.audit(request, organizationId, 'social_account.connected', account.id, {
        platform: account.platform,
        username: account.username,
      });
      return toSocialAccount(account);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Ce compte social est déjà connecté à cette organisation');
      }
      throw error;
    }
  }

  /**
   * Ouverture d'une connexion OAuth (§9.1).
   *
   * Renvoie l'URL d'autorisation du fournisseur, à visiter dans le navigateur.
   * Quand aucun identifiant d'application n'est configuré, la réponse est un
   * 409 qui nomme les variables d'environnement manquantes : la connexion n'est
   * jamais simulée pour faire joli.
   */
  @Post('connect')
  @HttpCode(200)
  @MinRole('ADMIN')
  async connect(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(connectRequestSchema)) body: ConnectRequestInput,
  ): Promise<ConnectResult> {
    const organizationId = this.org(request);
    const result = await this.oauth.authorize(organizationId, body);
    // Un compte existant réautorise : l'événement est rattaché à sa ligne.
    // Pour une nouvelle connexion, l'audit part à l'arrivée du callback.
    if (body.socialAccountId) {
      await this.audit(
        request,
        organizationId,
        'social_account.connect_started',
        body.socialAccountId,
        { platform: result.platform },
      );
    }
    return result;
  }

  /**
   * Santé des connexions (§9.2 / §9.3) : état, expiration, permissions
   * accordées, dernière panne et identifiants d'application manquants.
   */
  @Get('health')
  @MinRole('VIEWER')
  async health(@Req() request: AuthedRequest): Promise<ConnectionHealth[]> {
    return this.oauth.health(this.org(request));
  }

  /** Renouvellement explicite d'une autorisation (§9.3). */
  @Post(':id/refresh')
  @HttpCode(200)
  @MinRole('ADMIN')
  async refresh(@Req() request: AuthedRequest, @Param('id') id: string): Promise<SocialAccount> {
    return this.oauth.refresh(this.org(request), id, request.auth!.userId);
  }

  @Patch(':id')
  @MinRole('ADMIN')
  async update(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(updateSocialAccountSchema)) body: UpdateSocialAccountInput,
  ): Promise<SocialAccount> {
    const organizationId = this.org(request);
    const existing = await this.find(organizationId, id);
    if (body.brandId) await this.assertBrand(organizationId, body.brandId);
    const secret = this.secret();

    const account = await this.db.client.socialAccount.update({
      where: { id: existing.id },
      data: {
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.brandId !== undefined ? { brandId: body.brandId } : {}),
        ...(body.accessToken ? { accessToken: encryptSecret(body.accessToken, secret) } : {}),
        ...(body.refreshToken ? { refreshToken: encryptSecret(body.refreshToken, secret) } : {}),
        ...(body.tokenExpiresAt !== undefined
          ? { tokenExpiresAt: body.tokenExpiresAt ? new Date(body.tokenExpiresAt) : null }
          : {}),
      },
    });
    await this.audit(request, organizationId, 'social_account.updated', account.id, null);
    return toSocialAccount(account);
  }

  /**
   * Synchronisation : relit le profil auprès de la plateforme.
   *
   * Un échec n'est pas une exception : il est **enregistré sur le compte**
   * (`status: ERROR`, `lastError`, `lastErrorAt`) et renvoyé avec lui, pour que
   * l'interface guide la reconnexion au lieu d'afficher un compte faussement
   * sain.
   */
  @Post(':id/sync')
  @HttpCode(200)
  @MinRole('EDITOR')
  async sync(@Req() request: AuthedRequest, @Param('id') id: string): Promise<SocialAccount> {
    return this.oauth.sync(this.org(request), id, request.auth!.userId);
  }

  @Delete(':id')
  @HttpCode(204)
  @MinRole('ADMIN')
  async remove(@Req() request: AuthedRequest, @Param('id') id: string): Promise<void> {
    const organizationId = this.org(request);
    const existing = await this.find(organizationId, id);
    await this.db.client.socialAccount.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), status: 'REVOKED', accessToken: null, refreshToken: null },
    });
    await this.audit(request, organizationId, 'social_account.disconnected', existing.id, {
      platform: existing.platform,
      username: existing.username,
    });
  }

  private org(request: AuthedRequest): string {
    if (!request.auth?.organizationId) {
      throw new NotFoundException('Organisation active requise (X-Organization-Id)');
    }
    return request.auth.organizationId;
  }

  private secret(): string {
    if (!this.env.AUTH_SECRET) {
      throw new BadRequestException('AUTH_SECRET non configuré : chiffrement impossible');
    }
    return this.env.AUTH_SECRET;
  }

  private async find(organizationId: string, id: string) {
    const account = await this.db.client.socialAccount.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!account) throw new NotFoundException('Compte social introuvable');
    return account;
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
    targetId: string | null,
    metadata: Record<string, string | number | boolean> | null,
  ): Promise<void> {
    await this.db.client.auditLog.create({
      data: {
        organizationId,
        actorId: request.auth!.userId,
        action,
        targetType: 'social_account',
        targetId,
        ...(metadata ? { metadata } : {}),
      },
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function toSocialAccount(row: {
  id: string;
  organizationId: string;
  brandId: string | null;
  platform: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
  scopes: string[];
  tokenExpiresAt: Date | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  accessToken: string | null;
  refreshToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SocialAccount {
  return {
    id: row.id,
    organizationId: row.organizationId,
    brandId: row.brandId,
    platform: socialPlatformSchema.parse(row.platform),
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    status: socialAccountStatusSchema.parse(row.status),
    scopes: row.scopes,
    tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    hasAccessToken: Boolean(row.accessToken),
    hasRefreshToken: Boolean(row.refreshToken),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
