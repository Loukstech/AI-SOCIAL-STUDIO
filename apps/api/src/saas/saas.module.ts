import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { resolveFfmpegPath, runFfmpeg } from '@ass/worker-video';
import { Reflector } from '@nestjs/core';
import { AdminController } from '../admin/admin.controller.js';
import { AdminService } from '../admin/admin.service.js';
import { SuperAdminGuard } from '../admin/super-admin.guard.js';
import { AnalyticsController } from '../analytics/analytics.controller.js';
import { AnalyticsService } from '../analytics/analytics.service.js';
import { CreditsController } from '../billing/credits.controller.js';
import { CreditsService } from '../billing/credits.service.js';
import { AuthController } from '../auth/auth.controller.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { AuthService } from '../auth/auth.service.js';
import { CollaborationController } from '../collaboration/collaboration.controller.js';
import { CommentsController } from '../collaboration/comments.controller.js';
import { CommentsService } from '../collaboration/comments.service.js';
import { HistoryService } from '../collaboration/history.service.js';
import { PortfolioService } from '../collaboration/portfolio.service.js';
import { TasksController } from '../collaboration/tasks.controller.js';
import { TasksService } from '../collaboration/tasks.service.js';
import { Db } from '../common/validation.js';
import { ENV, type Env } from '../config/env.js';
import { BrandsController } from './brands.controller.js';
import { DashboardController } from './dashboard.controller.js';
import { InvitationAcceptanceController, InvitationsController } from './invitations.controller.js';
import { MediaController } from './media.controller.js';
import { MediaFileController } from './media-file.controller.js';
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
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { VideoPipelineService } from '../video/video-pipeline.service.js';
import {
  VIDEO_FFMPEG_CHECK,
  VIDEO_RENDER_RUNNER,
  VIDEO_SOURCE_ROOT,
  VideoRenderService,
} from '../video/video-render.service.js';
import { VideoProjectsController } from '../video/video-projects.controller.js';

@Module({
  controllers: [
    AdminController,
    CreditsController,
    AuthController,
    OrganizationsController,
    InvitationsController,
    InvitationAcceptanceController,
    BrandsController,
    MediaController,
    MediaFileController,
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
    CommentsController,
    TasksController,
    CollaborationController,
  ],
  providers: [
    Db,
    AdminService,
    CreditsService,
    SuperAdminGuard,
    AuthService,
    AuthGuard,
    Reflector,
    VideoPipelineService,
    VideoRenderService,
    { provide: VIDEO_RENDER_RUNNER, useValue: runFfmpeg },
    {
      provide: VIDEO_SOURCE_ROOT,
      useFactory: (env: Env) =>
        resolve(env.VIDEO_SOURCE_DIR ?? join(process.cwd(), 'tmp', 'uploads')),
      inject: [ENV],
    },
    {
      provide: VIDEO_FFMPEG_CHECK,
      useValue: async () => {
        try {
          return (await stat(resolveFfmpegPath())).isFile();
        } catch {
          return false;
        }
      },
    },
    ContentService,
    PublicationsService,
    PublishingScheduler,
    ImageService,
    ObjectStorageService,
    OAuthService,
    AnalyticsService,
    NotificationsService,
    CommentsService,
    TasksService,
    HistoryService,
    PortfolioService,
    // Aucun fournisseur transactionnel n'est branché : le transport inerte
    // refuse d'envoyer et le dit. Remplacer cette ligne par une implémentation
    // réelle suffira à activer le canal e-mail partout.
    { provide: MAIL_TRANSPORT, useValue: noopMailTransport },
  ],
  exports: [AuthGuard],
})
export class SaasModule {}
