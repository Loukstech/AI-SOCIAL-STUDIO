import { Body, Controller, Get, Inject, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import {
  adminAuditEntrySchema,
  adminOrganizationSchema,
  adminOverviewSchema,
  adminUserSchema,
  auditQuerySchema,
  planSchema,
  updateAdminUserSchema,
  updateOrganizationPlanSchema,
  type AdminAuditEntry,
  type AdminOrganization,
  type AdminOverview,
  type AdminUser,
  type AuditQuery,
  type Plan,
  type UpdateAdminUserInput,
  type UpdateOrganizationPlanInput,
} from '@ass/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';
import { ZodPipe } from '../common/validation.js';
import { AdminService } from './admin.service.js';
import { SuperAdminGuard } from './super-admin.guard.js';

/** Administration plateforme (§17) : aucun droit d'organisation requis. */
@Controller('admin')
@UseGuards(AuthGuard, SuperAdminGuard)
export class AdminController {
  constructor(@Inject(AdminService) private readonly service: AdminService) {}

  @Get('overview')
  async overview(): Promise<AdminOverview> {
    return adminOverviewSchema.parse(await this.service.overview());
  }

  @Get('plans')
  async plans(): Promise<Plan[]> {
    return (await this.service.plans()).map((row) => planSchema.parse(row));
  }

  @Get('users')
  async users(): Promise<AdminUser[]> {
    return (await this.service.users()).map((row) => adminUserSchema.parse(row));
  }

  @Patch('users/:id')
  async updateUser(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(updateAdminUserSchema)) body: UpdateAdminUserInput,
  ): Promise<AdminUser> {
    return adminUserSchema.parse(await this.service.updateUser(id, body, request.auth!));
  }

  @Get('organizations')
  async organizations(): Promise<AdminOrganization[]> {
    return (await this.service.organizations()).map((row) => adminOrganizationSchema.parse(row));
  }

  @Patch('organizations/:id/plan')
  async setPlan(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(updateOrganizationPlanSchema)) body: UpdateOrganizationPlanInput,
  ): Promise<AdminOrganization> {
    return adminOrganizationSchema.parse(await this.service.setPlan(id, body, request.auth!));
  }

  @Get('audit')
  async audit(@Query(new ZodPipe(auditQuerySchema)) query: AuditQuery): Promise<AdminAuditEntry[]> {
    return (await this.service.auditLog(query)).map((row) => adminAuditEntrySchema.parse(row));
  }
}
