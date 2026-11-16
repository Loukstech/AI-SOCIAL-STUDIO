import { Inject, Injectable } from '@nestjs/common';
import {
  isOverdue,
  type ClientSummary,
  type OrganizationRole,
  type Portfolio,
  type TaskStatus,
} from '@ass/shared';
import { Db } from '../common/validation.js';

/**
 * Tableau de bord agence (§14 : « espace client »).
 *
 * Un point de modélisation d'abord, parce qu'il détermine tout le reste : dans
 * ce produit, **un client est une organisation**. Il n'existe pas d'entité
 * `Client` séparée, et en inventer une dupliquerait les tenants, les rôles et
 * l'isolation déjà en place. Le portefeuille est donc la liste des
 * organisations dont l'utilisateur est membre, chacune résumée.
 *
 * Conséquences assumées :
 *
 * - Un membre `CLIENT` ne voit que sa propre organisation (il n'en a qu'une).
 * - Un membre d'agence voit les organisations où il a un rôle, et seulement
 *   celles-là : le portefeuille n'énumère jamais un tenant auquel on n'a pas
 *   accès.
 * - Les compteurs d'un client n'incluent pas les commentaires internes : le
 *   résumé ne doit pas laisser deviner ce qu'il ne peut pas lire.
 */

interface MembershipRow {
  role: string;
  organization: { id: string; name: string; slug: string; deletedAt: Date | null };
}

@Injectable()
export class PortfolioService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async overview(userId: string): Promise<Portfolio> {
    const memberships = await this.db.client.member.findMany({
      where: { userId, organization: { deletedAt: null } },
      select: {
        role: true,
        organization: { select: { id: true, name: true, slug: true, deletedAt: true } },
      },
      orderBy: { organization: { name: 'asc' } },
    });

    const clients = await Promise.all(
      memberships.map((membership) => this.summarize(membership as unknown as MembershipRow)),
    );

    return {
      clients,
      totals: {
        clients: clients.length,
        publications: sum(clients, (client) => client.publications),
        pendingApprovals: sum(clients, (client) => client.pendingApprovals),
        openTasks: sum(clients, (client) => client.openTasks),
        overdueTasks: sum(clients, (client) => client.overdueTasks),
      },
    };
  }

  private async summarize(membership: MembershipRow): Promise<ClientSummary> {
    const db = this.db.client;
    const organizationId = membership.organization.id;
    const role = membership.role as OrganizationRole;
    // Un client ne compte que ce qu'il peut voir.
    const commentScope = role === 'CLIENT' ? { visibility: 'CLIENT' as const } : {};

    const [publications, pendingApprovals, tasks, openComments, lastEvent, lastAudit, lastComment] =
      await Promise.all([
        db.publication.count({ where: { organizationId, deletedAt: null } }),
        db.publication.count({
          where: { organizationId, deletedAt: null, status: 'PENDING_APPROVAL' },
        }),
        db.task.findMany({
          where: { organizationId },
          select: { status: true, dueAt: true },
        }),
        db.comment.count({
          where: { organizationId, deletedAt: null, resolvedAt: null, ...commentScope },
        }),
        db.publicationEvent.findFirst({
          where: { publication: { organizationId } },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
        db.auditLog.findFirst({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
        db.comment.findFirst({
          where: { organizationId, deletedAt: null, ...commentScope },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]);

    const openTasks = tasks.filter((task) => (task.status as TaskStatus) === 'OPEN');
    const dates = [lastEvent?.createdAt, lastAudit?.createdAt, lastComment?.createdAt].filter(
      (date): date is Date => Boolean(date),
    );
    const lastActivityAt = dates.length
      ? new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString()
      : null;

    return {
      organizationId,
      name: membership.organization.name,
      slug: membership.organization.slug,
      role,
      publications,
      pendingApprovals,
      openTasks: openTasks.length,
      overdueTasks: openTasks.filter((task) =>
        isOverdue({ status: 'OPEN', dueAt: task.dueAt ? task.dueAt.toISOString() : null }),
      ).length,
      openComments,
      lastActivityAt,
    };
  }
}

function sum(clients: ClientSummary[], pick: (client: ClientSummary) => number): number {
  return clients.reduce((total, client) => total + pick(client), 0);
}
