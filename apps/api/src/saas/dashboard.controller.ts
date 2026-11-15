import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import type { DashboardStats } from '@ass/shared';
import { Db } from '../common/validation.js';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get()
  async stats(@Req() request: AuthedRequest): Promise<DashboardStats> {
    const db = this.db.client;
    const userId = request.auth!.userId;
    const orgId = request.auth!.organizationId || undefined;
    const [organizations, brands, media, members, socialAccounts, pendingInvitations, activity] =
      await Promise.all([
        db.member.count({ where: { userId } }),
        orgId
          ? db.brand.count({ where: { organizationId: orgId, deletedAt: null } })
          : Promise.resolve(0),
        orgId
          ? db.mediaAsset.count({ where: { organizationId: orgId, deletedAt: null } })
          : Promise.resolve(0),
        orgId ? db.member.count({ where: { organizationId: orgId } }) : Promise.resolve(0),
        orgId
          ? db.socialAccount.count({ where: { organizationId: orgId, deletedAt: null } })
          : Promise.resolve(0),
        orgId
          ? db.invitation.count({
              where: {
                organizationId: orgId,
                acceptedAt: null,
                revokedAt: null,
                expiresAt: { gt: new Date() },
              },
            })
          : Promise.resolve(0),
        orgId
          ? db.auditLog.findMany({
              where: { organizationId: orgId },
              orderBy: { createdAt: 'desc' },
              take: 8,
            })
          : Promise.resolve([]),
      ]);
    return {
      organizations,
      brands,
      media,
      members,
      socialAccounts,
      pendingInvitations,
      recentActivity: activity.map((log) => ({
        id: log.id,
        action: log.action,
        targetType: log.targetType,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  }
}
