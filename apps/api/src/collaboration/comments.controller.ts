import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  commentListSchema,
  commentSchema,
  createCommentSchema,
  updateCommentSchema,
  type Comment,
  type CommentList,
  type CreateCommentInput,
  type OrganizationRole,
  type UpdateCommentInput,
} from '@ass/shared';
import { ZodPipe } from '../common/validation.js';
import { AuthGuard, MinRole } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';
import { CommentsService } from './comments.service.js';

/**
 * Commentaires (§14).
 *
 * Les routes sont volontairement asymétriques : lire demande le rôle le plus
 * bas (un lecteur doit pouvoir suivre un échange), écrire demande `CLIENT`.
 * Un `VIEWER` consulte, il ne commente pas — et le filtre de visibilité est
 * appliqué côté service, pas ici.
 */
@Controller()
@UseGuards(AuthGuard)
export class CommentsController {
  constructor(@Inject(CommentsService) private readonly comments: CommentsService) {}

  @Get('publications/:id/comments')
  @MinRole('VIEWER')
  async list(@Req() request: AuthedRequest, @Param('id') id: string): Promise<CommentList> {
    const { organizationId, role } = this.identity(request);
    return commentListSchema.parse(
      await this.comments.list(organizationId, role, 'publication', id),
    );
  }

  @Post('publications/:id/comments')
  @MinRole('CLIENT')
  async create(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(createCommentSchema)) body: CreateCommentInput,
  ): Promise<Comment> {
    const { organizationId, userId, role } = this.identity(request);
    return commentSchema.parse(
      await this.comments.create(organizationId, { userId, role }, 'publication', id, body),
    );
  }

  @Patch('comments/:id')
  @MinRole('CLIENT')
  async update(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(updateCommentSchema)) body: UpdateCommentInput,
  ): Promise<Comment> {
    const { organizationId, userId, role } = this.identity(request);
    return commentSchema.parse(
      await this.comments.update(organizationId, { userId, role }, id, body),
    );
  }

  @Delete('comments/:id')
  @HttpCode(204)
  @MinRole('CLIENT')
  async remove(@Req() request: AuthedRequest, @Param('id') id: string): Promise<void> {
    const { organizationId, userId, role } = this.identity(request);
    await this.comments.remove(organizationId, { userId, role }, id);
  }

  private identity(request: AuthedRequest): {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
  } {
    if (!request.auth?.organizationId) {
      throw new NotFoundException('Organisation active requise (X-Organization-Id)');
    }
    return {
      organizationId: request.auth.organizationId,
      userId: request.auth.userId,
      role: request.auth.role,
    };
  }
}
