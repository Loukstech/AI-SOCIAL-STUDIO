import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  sortTasks,
  type CreateTaskInput,
  type Task,
  type TaskStatus,
  type UpdateTaskInput,
} from '@ass/shared';
import { Db } from '../common/validation.js';

/**
 * Tâches (§14).
 *
 * Une tâche peut viser un contenu (assignation ciblée) ou exister seule
 * (tâche d'organisation). Les deux cas partagent le même modèle : c'est
 * l'absence de `entityType` qui distingue une tâche libre.
 *
 * Deux invariants :
 *
 * - **L'assigné doit être membre de l'organisation.** Assigner à un inconnu
 *   créerait une tâche que personne ne voit.
 * - **`completedAt` suit `status`, dans les deux sens.** Terminer date,
 *   rouvrir efface la date — un état intermédiaire incohérent serait un
 *   mensonge de plus à traîner.
 */

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  assigneeId: string | null;
  createdById: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: Date;
  updatedAt: Date;
  assignee: { name: string } | null;
  createdBy: { name: string } | null;
}

const taskInclude = {
  assignee: { select: { name: true } },
  createdBy: { select: { name: true } },
} as const;

@Injectable()
export class TasksService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async list(
    organizationId: string,
    query: { entityType?: string; entityId?: string; assigneeId?: string; status?: TaskStatus },
  ): Promise<Task[]> {
    const rows = await this.db.client.task.findMany({
      where: {
        organizationId,
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: taskInclude,
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });
    return sortTasks(rows.map(toTask));
  }

  async create(organizationId: string, actorId: string, input: CreateTaskInput): Promise<Task> {
    if (input.assigneeId) await this.assertMember(organizationId, input.assigneeId);
    if (input.entityType || input.entityId) {
      if (!input.entityType || !input.entityId) {
        throw new BadRequestException('`entityType` et `entityId` vont ensemble');
      }
      await this.assertEntity(organizationId, input.entityType, input.entityId);
    }

    const row = await this.db.client.task.create({
      data: {
        organizationId,
        title: input.title,
        description: input.description ?? null,
        assigneeId: input.assigneeId ?? null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        createdById: actorId,
      },
      include: taskInclude,
    });
    return toTask(row as unknown as TaskRow);
  }

  async update(organizationId: string, id: string, input: UpdateTaskInput): Promise<Task> {
    const existing = await this.find(organizationId, id);
    if (input.assigneeId) await this.assertMember(organizationId, input.assigneeId);

    const statusChanged = input.status !== undefined && input.status !== existing.status;

    const row = await this.db.client.task.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(statusChanged ? { completedAt: input.status === 'DONE' ? new Date() : null } : {}),
      },
      include: taskInclude,
    });
    return toTask(row as unknown as TaskRow);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    await this.find(organizationId, id);
    await this.db.client.task.delete({ where: { id } });
  }

  private async find(organizationId: string, id: string) {
    const row = await this.db.client.task.findFirst({
      where: { id, organizationId },
      select: { id: true, status: true },
    });
    if (!row) throw new NotFoundException('Tâche introuvable');
    return row;
  }

  /** Assigner une tâche à quelqu'un qui n'est pas membre ne notifie personne. */
  private async assertMember(organizationId: string, userId: string): Promise<void> {
    const member = await this.db.client.member.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { userId: true },
    });
    if (!member) {
      throw new BadRequestException('L’assigné doit être membre de cette organisation');
    }
  }

  private async assertEntity(
    organizationId: string,
    entityType: string,
    entityId: string,
  ): Promise<void> {
    if (entityType !== 'publication') {
      throw new BadRequestException(
        `Type de contenu non assignable : « ${entityType} ». Types acceptés : publication`,
      );
    }
    const publication = await this.db.client.publication.findFirst({
      where: { id: entityId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!publication) throw new NotFoundException('Contenu introuvable');
  }
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    assigneeId: row.assigneeId,
    assigneeName: row.assignee?.name ?? null,
    createdById: row.createdById,
    createdByName: row.createdBy?.name ?? null,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    entityType: row.entityType,
    entityId: row.entityId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
