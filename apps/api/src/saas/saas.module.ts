import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthController } from '../auth/auth.controller.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { AuthService } from '../auth/auth.service.js';
import { Db } from '../common/validation.js';
import { BrandsController } from './brands.controller.js';
import { DashboardController } from './dashboard.controller.js';
import { MediaController } from './media.controller.js';
import { OrganizationsController } from './organizations.controller.js';

@Module({
  controllers: [
    AuthController,
    OrganizationsController,
    BrandsController,
    MediaController,
    DashboardController,
  ],
  providers: [Db, AuthService, AuthGuard, Reflector],
  exports: [AuthGuard],
})
export class SaasModule {}
