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
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  notificationCatalogResponseSchema,
  notificationListSchema,
  notificationPreferencesSchema,
  notificationQuerySchema,
  notificationSchema,
  unreadCountSchema,
  updatePreferencesSchema,
  type Notification,
  type NotificationCatalogResponse,
  type NotificationList,
  type NotificationPreference,
  type NotificationQuery,
  type UnreadCount,
  type UpdatePreferencesInput,
} from '@ass/shared';
import { ZodPipe } from '../common/validation.js';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Notifications (§15).
 *
 * Toutes les routes sont personnelles : on ne lit, ne marque et ne supprime que
 * ses propres notifications. Aucun rôle particulier n'est exigé — un lecteur a
 * le droit de savoir qu'un contenu l'attend, et un invité de recevoir un
 * avertissement de connexion.
 */
@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @Req() request: AuthedRequest,
    @Query(new ZodPipe(notificationQuerySchema)) query: NotificationQuery,
  ): Promise<NotificationList> {
    const { organizationId, userId } = this.identity(request);
    return notificationListSchema.parse(
      await this.notifications.list(organizationId, userId, query),
    );
  }

  @Get('unread-count')
  async unread(@Req() request: AuthedRequest): Promise<UnreadCount> {
    const { organizationId, userId } = this.identity(request);
    return unreadCountSchema.parse(await this.notifications.unreadCount(organizationId, userId));
  }

  /**
   * Catalogue des événements du §15 et état réel du canal e-mail.
   *
   * Sert à afficher, sans le maquiller, ce qui est notifié aujourd'hui et ce
   * qui ne l'est pas encore.
   */
  @Get('catalog')
  catalog(): NotificationCatalogResponse {
    return notificationCatalogResponseSchema.parse(this.notifications.catalog());
  }

  @Get('preferences')
  async preferences(@Req() request: AuthedRequest): Promise<NotificationPreference[]> {
    const { organizationId, userId } = this.identity(request);
    return notificationPreferencesSchema.parse(
      await this.notifications.preferences(organizationId, userId),
    );
  }

  @Put('preferences')
  async updatePreferences(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(updatePreferencesSchema)) body: UpdatePreferencesInput,
  ): Promise<NotificationPreference[]> {
    const { organizationId, userId } = this.identity(request);
    return notificationPreferencesSchema.parse(
      await this.notifications.updatePreferences(organizationId, userId, body),
    );
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@Req() request: AuthedRequest): Promise<UnreadCount> {
    const { organizationId, userId } = this.identity(request);
    return unreadCountSchema.parse(await this.notifications.markAllRead(organizationId, userId));
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@Req() request: AuthedRequest, @Param('id') id: string): Promise<Notification> {
    const { organizationId, userId } = this.identity(request);
    return notificationSchema.parse(await this.notifications.markRead(organizationId, userId, id));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() request: AuthedRequest, @Param('id') id: string): Promise<void> {
    const { organizationId, userId } = this.identity(request);
    await this.notifications.remove(organizationId, userId, id);
  }

  private identity(request: AuthedRequest): { organizationId: string; userId: string } {
    if (!request.auth?.organizationId) {
      throw new NotFoundException('Organisation active requise (X-Organization-Id)');
    }
    return { organizationId: request.auth.organizationId, userId: request.auth.userId };
  }
}
