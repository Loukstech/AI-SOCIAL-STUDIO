import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AdminAuditEntry,
  AdminOrganization,
  AdminOverview,
  AdminUser,
  AuditQuery,
  UpdateAdminUserInput,
  UpdateOrganizationPlanInput,
} from '@ass/shared';
import { Db } from '../common/validation.js';
import type { AuthContext } from '../auth/auth.types.js';

type UserRow = {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  deletedAt: Date | null;
  isSuperAdmin: boolean;
  _count?: { memberships: number };
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  planKey: string;
  createdAt: Date;
  _count?: { members: number };
};

type AuditRow = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: Date;
  actor?: { email: string } | null;
  organization?: { name: string } | null;
};

@Injectable()
export class AdminService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async overview(): Promise<AdminOverview> {
    const db = this.db.client;
    const [users, organizations, disabledUsers, superAdmins, plans] = await Promise.all([
      db.user.count({ where: { deletedAt: null } }),
      db.organization.count({ where: { deletedAt: null } }),
      db.user.count({ where: { deletedAt: { not: null } } }),
      db.user.count({ where: { isSuperAdmin: true, deletedAt: null } }),
      db.plan.count(),
    ]);
    return { users, organizations, disabledUsers, superAdmins, plans };
  }

  async plans(): Promise<
    { key: string; name: string; monthlyCredits: number | null; active: boolean }[]
  > {
    return this.db.client.plan.findMany({
      where: { active: true },
      select: { key: true, name: true, monthlyCredits: true, active: true },
      orderBy: { name: 'asc' },
    });
  }

  async users(): Promise<AdminUser[]> {
    const rows = (await this.db.client.user.findMany({
      include: { _count: { select: { memberships: true } } },
      orderBy: { createdAt: 'desc' },
    })) as UserRow[];
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      isSuperAdmin: row.isSuperAdmin,
      disabled: row.deletedAt !== null,
      organizations: row._count?.memberships ?? 0,
    }));
  }

  /** Désactiver un compte passe par `deletedAt` : rien n'est supprimé. */
  async updateUser(
    id: string,
    input: UpdateAdminUserInput,
    actor: AuthContext,
  ): Promise<AdminUser> {
    const existing = await this.db.client.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Utilisateur introuvable');

    if (input.isSuperAdmin === false) {
      const remaining = await this.db.client.user.count({
        where: { isSuperAdmin: true, deletedAt: null, id: { not: id } },
      });
      if (remaining === 0) {
        throw new BadRequestException('Au moins un administrateur plateforme doit rester actif');
      }
    }

    const updated = (await this.db.client.user.update({
      where: { id },
      data: {
        ...(input.isSuperAdmin === undefined ? {} : { isSuperAdmin: input.isSuperAdmin }),
        ...(input.disabled === undefined ? {} : { deletedAt: input.disabled ? new Date() : null }),
      },
      include: { _count: { select: { memberships: true } } },
    })) as UserRow;

    await this.audit(actor, 'admin.user.updated', 'user', id, {
      isSuperAdmin: input.isSuperAdmin,
      disabled: input.disabled,
    });

    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      createdAt: updated.createdAt.toISOString(),
      isSuperAdmin: updated.isSuperAdmin,
      disabled: updated.deletedAt !== null,
      organizations: updated._count?.memberships ?? 0,
    };
  }

  async organizations(): Promise<AdminOrganization[]> {
    const rows = (await this.db.client.organization.findMany({
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: 'desc' },
    })) as OrganizationRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      planKey: row.planKey,
      members: row._count?.members ?? 0,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async setPlan(
    organizationId: string,
    input: UpdateOrganizationPlanInput,
    actor: AuthContext,
  ): Promise<AdminOrganization> {
    const plan = await this.db.client.plan.findUnique({ where: { key: input.planKey } });
    if (!plan || !plan.active) throw new NotFoundException('Plan introuvable ou inactif');

    const organization = (await this.db.client.organization.update({
      where: { id: organizationId },
      data: { planKey: input.planKey },
      include: { _count: { select: { members: true } } },
    })) as OrganizationRow;

    await this.db.client.creditAccount.upsert({
      where: { organizationId },
      create: {
        organizationId,
        planKey: plan.key,
        balance: plan.monthlyCredits ?? 0,
      },
      update: { planKey: plan.key },
    });

    await this.audit(actor, 'admin.organization.plan_changed', 'organization', organizationId, {
      planKey: input.planKey,
    });

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      planKey: organization.planKey,
      members: organization._count?.members ?? 0,
      createdAt: organization.createdAt.toISOString(),
    };
  }

  async audit(
    actor: AuthContext,
    action: string,
    targetType?: string,
    targetId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const safeMetadata = metadata
      ? (Object.fromEntries(
          Object.entries(metadata).filter(([, value]) => value !== undefined),
        ) as Record<string, string | number | boolean | null>)
      : undefined;

    await this.db.client.auditLog.create({
      data: {
        organizationId: null,
        actorId: actor.userId,
        action,
        targetType: targetType ?? null,
        targetId: targetId ?? null,
        metadata: safeMetadata,
      },
    });
  }

  async auditLog(query: AuditQuery): Promise<AdminAuditEntry[]> {
    const rows = (await this.db.client.auditLog.findMany({
      where: { organizationId: null },
      include: { actor: { select: { email: true } }, organization: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    })) as AuditRow[];

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      actorEmail: row.actor?.email ?? null,
      organizationName: row.organization?.name ?? null,
      targetType: row.targetType,
      targetId: row.targetId,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
