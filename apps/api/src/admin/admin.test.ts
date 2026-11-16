import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthContext } from '../auth/auth.types.js';
import type { Db } from '../common/validation.js';
import { AdminService } from './admin.service.js';
import { SuperAdminGuard } from './super-admin.guard.js';

interface UserRow {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  deletedAt: Date | null;
  isSuperAdmin: boolean;
  memberships: string[];
}

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  planKey: string;
  createdAt: Date;
  members: string[];
}

const actor: AuthContext = {
  userId: 'admin-1',
  email: 'admin@example.test',
  sessionId: 'session-1',
  organizationId: '',
  role: 'VIEWER',
  isSuperAdmin: true,
};

function fakeDb() {
  const users: UserRow[] = [
    {
      id: 'admin-1',
      email: 'admin@example.test',
      name: 'Admin',
      createdAt: new Date('2026-01-01'),
      deletedAt: null,
      isSuperAdmin: true,
      memberships: ['org-1'],
    },
    {
      id: 'user-2',
      email: 'user@example.test',
      name: 'Utilisateur',
      createdAt: new Date('2026-02-01'),
      deletedAt: null,
      isSuperAdmin: false,
      memberships: ['org-1', 'org-2'],
    },
  ];
  const organizations: OrganizationRow[] = [
    {
      id: 'org-1',
      name: 'Agence',
      slug: 'agence',
      planKey: 'free',
      createdAt: new Date('2026-01-01'),
      members: ['admin-1', 'user-2'],
    },
  ];
  const plans = [{ key: 'free', name: 'Découverte', monthlyCredits: 100, active: true }];
  const audits: Record<string, unknown>[] = [];
  const accounts: { organizationId: string; planKey: string; balance: number }[] = [];

  const withCount = (row: UserRow) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
    isSuperAdmin: row.isSuperAdmin,
    _count: { memberships: row.memberships.length },
  });
  const withOrgCount = (row: OrganizationRow) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    planKey: row.planKey,
    createdAt: row.createdAt,
    _count: { members: row.members.length },
  });

  const client = {
    user: {
      count: async ({ where }: { where?: Record<string, unknown> } = {}) => {
        if (!where) return users.length;
        return users.filter((row) =>
          Object.entries(where).every(([key, condition]) => {
            if (key === 'isSuperAdmin') return row.isSuperAdmin === condition;
            if (key === 'id') {
              if (typeof condition === 'string') return row.id === condition;
              if (condition && typeof condition === 'object' && 'not' in condition) {
                return row.id !== (condition as { not: string }).not;
              }
            }
            if (key === 'deletedAt') {
              if (condition === null) return row.deletedAt === null;
              if (condition && typeof condition === 'object' && 'not' in condition) {
                return row.deletedAt !== (condition as { not: Date | null }).not;
              }
            }
            return true;
          }),
        ).length;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = users.find((item) => item.id === where.id);
        return row ? withCount(row) : null;
      },
      findMany: async () => users.map(withCount),
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { isSuperAdmin?: boolean; deletedAt?: Date | null };
      }) => {
        const row = users.find((item) => item.id === where.id)!;
        if (data.isSuperAdmin !== undefined) row.isSuperAdmin = data.isSuperAdmin;
        if (data.deletedAt !== undefined) row.deletedAt = data.deletedAt;
        return withCount(row);
      },
    },
    organization: {
      count: async () => organizations.length,
      findMany: async () => organizations.map(withOrgCount),
      findUnique: async ({ where }: { where: { id: string } }) =>
        organizations.find((row) => row.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { planKey: string } }) => {
        const row = organizations.find((item) => item.id === where.id)!;
        row.planKey = data.planKey;
        return withOrgCount(row);
      },
    },
    plan: {
      count: async () => plans.length,
      findUnique: async ({ where }: { where: { key: string } }) =>
        plans.find((row) => row.key === where.key) ?? null,
    },
    creditAccount: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { organizationId: string };
        create: { organizationId: string; planKey: string; balance: number };
        update: { planKey: string };
      }) => {
        let row = accounts.find((item) => item.organizationId === where.organizationId);
        if (!row) {
          row = { ...create };
          accounts.push(row);
        } else {
          row.planKey = update.planKey;
        }
        return { ...row };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return { id: `audit-${audits.length}`, ...data };
      },
      findMany: async ({ take }: { take: number }) => audits.slice(0, take),
    },
  };

  return {
    db: { client } as unknown as Db,
    users,
    organizations,
    audits,
    accounts,
  };
}

describe('administration plateforme (§17)', () => {
  let context: ReturnType<typeof fakeDb>;
  let service: AdminService;

  beforeEach(() => {
    context = fakeDb();
    service = new AdminService(context.db);
  });

  it('compte les comptes actifs, désactivés et les administrateurs', async () => {
    const overview = await service.overview();
    expect(overview).toEqual({
      users: 2,
      organizations: 1,
      disabledUsers: 0,
      superAdmins: 1,
      plans: 1,
    });
  });

  it('désactive un compte sans le supprimer et journalise l’action', async () => {
    const updated = await service.updateUser('user-2', { disabled: true }, actor);
    expect(updated.disabled).toBe(true);
    expect(context.users[1]?.deletedAt).toBeInstanceOf(Date);
    expect(context.audits[0]?.action).toBe('admin.user.updated');
    expect(context.audits[0]?.actorId).toBe('admin-1');
  });

  it('refuse de retirer le dernier administrateur plateforme', async () => {
    await expect(service.updateUser('admin-1', { isSuperAdmin: false }, actor)).rejects.toThrow(
      'Au moins un administrateur plateforme doit rester actif',
    );
  });

  it('change le plan d’une organisation et aligne son compte de crédits', async () => {
    const updated = await service.setPlan('org-1', { planKey: 'free' }, actor);
    expect(updated.planKey).toBe('free');
    expect(context.accounts[0]).toMatchObject({ organizationId: 'org-1', planKey: 'free' });
    expect(context.audits[0]?.action).toBe('admin.organization.plan_changed');
  });

  it('ne laisse pas un membre ordinaire entrer dans l’administration', () => {
    const guard = new SuperAdminGuard();
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ auth: { isSuperAdmin: false } }) }),
    };
    expect(() => guard.canActivate(context as never)).toThrow('Administration plateforme réservée');
  });
});
