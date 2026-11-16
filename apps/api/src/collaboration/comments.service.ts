import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canSeeComment,
  countOpen,
  type Comment,
  type CommentList,
  type CommentVisibility,
  type CreateCommentInput,
  type UpdateCommentInput,
} from '@ass/shared';
import { Db } from '../common/validation.js';
import type { OrganizationRole } from '@ass/shared';

/**
 * Commentaires (§14).
 *
 * Deux règles portent ce service :
 *
 * 1. **La visibilité est filtrée en base, pas à l'écran.** Un client ne reçoit
 *    jamais une ligne `INTERNAL` : elle n'est pas envoyée, elle n'est pas
 *    cachée côté navigateur.
 * 2. **Une réponse hérite de la visibilité de son parent.** Sans cela, un client
 *    répondant à un commentaire visible créerait un fil interne, et un interne
 *    répondant à un fil client divulguerait une note privée.
 */

/** Types d'entités réellement commentables. */
const SUPPORTED_ENTITIES = ['publication'] as const;
type SupportedEntity = (typeof SUPPORTED_ENTITIES)[number];

/** Rôles autorisés à résoudre un commentaire. */
const RESOLVER_ROLES: OrganizationRole[] = ['OWNER', 'ADMIN', 'EDITOR'];

export interface CommentActor {
  userId: string;
  role: OrganizationRole;
}

interface CommentRow {
  id: string;
  entityType: string;
  entityId: string;
  authorId: string;
  body: string;
  visibility: string;
  parentId: string | null;
  resolvedAt: Date | null;
  resolvedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  author: { name: string };
}

@Injectable()
export class CommentsService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async list(
    organizationId: string,
    role: OrganizationRole,
    entityType: string,
    entityId: string,
  ): Promise<CommentList> {
    await this.assertEntity(organizationId, entityType, entityId);

    const rows = await this.db.client.comment.findMany({
      where: {
        organizationId,
        entityType,
        entityId,
        deletedAt: null,
        // Le filtre de visibilité est dans la requête : une ligne interne ne
        // quitte jamais la base pour un client.
        ...(role === 'CLIENT' ? { visibility: 'CLIENT' as CommentVisibility } : {}),
      },
      orderBy: [{ createdAt: 'asc' }],
      include: { author: { select: { name: true } } },
    });

    const views = await this.withResolvers(rows as unknown as CommentRow[]);
    return {
      comments: views,
      total: views.length,
      open: countOpen(views),
    };
  }

  async create(
    organizationId: string,
    actor: CommentActor,
    entityType: string,
    entityId: string,
    input: CreateCommentInput,
  ): Promise<Comment> {
    await this.assertEntity(organizationId, entityType, entityId);

    let visibility: CommentVisibility = input.visibility;

    if (input.parentId) {
      const parent = await this.db.client.comment.findFirst({
        where: {
          id: input.parentId,
          organizationId,
          entityType,
          entityId,
          deletedAt: null,
        },
        select: { id: true, parentId: true, visibility: true },
      });
      if (!parent) throw new NotFoundException('Commentaire parent introuvable');
      if (parent.parentId) {
        throw new BadRequestException(
          'Les réponses ne s’imbriquent que sur un niveau : répondez au commentaire d’origine',
        );
      }
      if (!canSeeComment(actor.role, parent.visibility as CommentVisibility)) {
        throw new NotFoundException('Commentaire parent introuvable');
      }
      // Héritage : le fil garde la portée de son origine.
      visibility = parent.visibility as CommentVisibility;
    } else if (actor.role === 'CLIENT') {
      // Un client n'écrit pas de note interne : tout ce qu'il dépose est visible
      // de l'agence et de lui.
      visibility = 'CLIENT';
    }

    const row = await this.db.client.comment.create({
      data: {
        organizationId,
        entityType,
        entityId,
        authorId: actor.userId,
        body: input.body,
        visibility,
        parentId: input.parentId ?? null,
      },
      include: { author: { select: { name: true } } },
    });

    return toComment(row as unknown as CommentRow, null);
  }

  async update(
    organizationId: string,
    actor: CommentActor,
    id: string,
    input: UpdateCommentInput,
  ): Promise<Comment> {
    const row = await this.find(organizationId, actor.role, id);

    if (input.body !== undefined && row.authorId !== actor.userId) {
      throw new ForbiddenException('Seul l’auteur peut modifier le texte d’un commentaire');
    }

    if (input.resolved !== undefined) {
      const allowed = RESOLVER_ROLES.includes(actor.role) || row.authorId === actor.userId;
      if (!allowed) {
        throw new ForbiddenException('Résolution réservée à l’auteur ou à un éditeur');
      }
    }

    const updated = await this.db.client.comment.update({
      where: { id },
      data: {
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.resolved === true ? { resolvedAt: new Date(), resolvedById: actor.userId } : {}),
        ...(input.resolved === false ? { resolvedAt: null, resolvedById: null } : {}),
      },
      include: { author: { select: { name: true } } },
    });

    return (await this.withResolvers([updated as unknown as CommentRow]))[0]!;
  }

  /** Suppression logique : le fil reste lisible dans l'historique. */
  async remove(organizationId: string, actor: CommentActor, id: string): Promise<void> {
    const row = await this.find(organizationId, actor.role, id);
    const isModerator = actor.role === 'OWNER' || actor.role === 'ADMIN';
    if (row.authorId !== actor.userId && !isModerator) {
      throw new ForbiddenException(
        'Seul l’auteur ou un administrateur peut supprimer ce commentaire',
      );
    }
    await this.db.client.comment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // --- Aides ---

  private async find(
    organizationId: string,
    role: OrganizationRole,
    id: string,
  ): Promise<CommentRow> {
    const row = await this.db.client.comment.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: { author: { select: { name: true } } },
    });
    // Une ligne invisible pour ce rôle est traitée comme inexistante : son
    // existence n'est pas divulguée.
    if (!row || !canSeeComment(role, row.visibility as CommentVisibility)) {
      throw new NotFoundException('Commentaire introuvable');
    }
    return row as unknown as CommentRow;
  }

  /** Vérifie que l'entité visée existe dans cette organisation. */
  private async assertEntity(
    organizationId: string,
    entityType: string,
    entityId: string,
  ): Promise<void> {
    if (!SUPPORTED_ENTITIES.includes(entityType as SupportedEntity)) {
      throw new BadRequestException(
        `Type de contenu non commentable : « ${entityType} ». Types acceptés : ${SUPPORTED_ENTITIES.join(', ')}`,
      );
    }
    const publication = await this.db.client.publication.findFirst({
      where: { id: entityId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!publication) throw new NotFoundException('Contenu introuvable');
  }

  /** Ajoute le nom du résolveur, absent de la relation auteur. */
  private async withResolvers(rows: CommentRow[]): Promise<Comment[]> {
    const resolverIds = [
      ...new Set(rows.map((row) => row.resolvedById).filter(Boolean)),
    ] as string[];
    const resolvers = resolverIds.length
      ? await this.db.client.user.findMany({
          where: { id: { in: resolverIds } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(resolvers.map((user) => [user.id, user.name]));
    return rows.map((row) =>
      toComment(row, row.resolvedById ? (names.get(row.resolvedById) ?? null) : null),
    );
  }
}

function toComment(row: CommentRow, resolvedByName: string | null): Comment {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    authorId: row.authorId,
    authorName: row.author.name,
    body: row.body,
    visibility: row.visibility as CommentVisibility,
    parentId: row.parentId,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolvedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
