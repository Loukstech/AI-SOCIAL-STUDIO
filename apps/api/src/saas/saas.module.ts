import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
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
    VideoProjectsController,
    DashboardController,
  ],
  providers: [Db, AuthService, AuthGuard, Reflector, VideoPipelineService],
  exports: [AuthGuard],
})
export class SaasModule {}
