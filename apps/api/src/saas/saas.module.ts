import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AnalyticsController } from '../analytics/analytics.controller.js';
import { AnalyticsService } from '../analytics/analytics.service.js';
import { AuthController } from '../auth/auth.controller.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { AuthService } from '../auth/auth.service.js';
import { Db } from '../common/validation.js';
import { BrandsController } from './brands.controller.js';
import { DashboardController } from './dashboard.controller.js';
import { InvitationAcceptanceController, InvitationsController } from './invitations.controller.js';
import { MediaController } from './media.controller.js';
import { OrganizationsController } from './organizations.controller.js';
import { SocialAccountsController } from './social-accounts.controller.js';
import { ContentController, ContentGenerationController } from '../content/content.controller.js';
import { ContentService } from '../content/content.service.js';
import { ImageProjectsController } from '../image/image.controller.js';
import { ImageService } from '../image/image.service.js';
import { MAIL_TRANSPORT, noopMailTransport } from '../notifications/mail.js';
import { NotificationsController } from '../notifications/notifications.controller.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CalendarController } from '../publishing/calendar.controller.js';
import { PublicationsController } from '../publishing/publications.controller.js';
import { PublicationsService } from '../publishing/publications.service.js';
import { PublishingScheduler } from '../publishing/scheduler.service.js';
import { OAuthCallbackController } from '../social/oauth-callback.controller.js';
import { OAuthService } from '../social/oauth.service.js';
import { VideoPipelineService } from '../video/video-pipeline.service.js';
import { VideoProjectsController } from '../video/video-projects.controller.js';

@Module({
  controllers: [
    AuthController,
    OrganizationsController,
    InvitationsController,
    InvitationAcceptanceController,
    BrandsController,
    MediaController,
    SocialAccountsController,
    OAuthCallbackController,
    AnalyticsController,
    VideoProjectsController,
    ContentGenerationController,
    ContentController,
    PublicationsController,
    CalendarController,
    ImageProjectsController,
    DashboardController,
    NotificationsController,
  ],
  providers: [
    Db,
    AuthService,
    AuthGuard,
    Reflector,
    VideoPipelineService,
    ContentService,
    PublicationsService,
    PublishingScheduler,
    ImageService,
    OAuthService,
    AnalyticsService,
    NotificationsService,
    // Aucun fournisseur transactionnel n'est branché : le transport inerte
    // refuse d'envoyer et le dit. Remplacer cette ligne par une implémentation
    // réelle suffira à activer le canal e-mail partout.
    { provide: MAIL_TRANSPORT, useValue: noopMailTransport },
  ],
  exports: [AuthGuard],
})
export class SaasModule {}
