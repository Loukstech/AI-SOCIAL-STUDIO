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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createTaskSchema,
  taskQuerySchema,
  taskSchema,
  updateTaskSchema,
  type CreateTaskInput,
  type Task,
  type TaskQuery,
  type UpdateTaskInput,
} from '@ass/shared';
import { ZodPipe } from '../common/validation.js';
import { AuthGuard, MinRole } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';
import { TasksService } from './tasks.service.js';

/**
 * Tâches (§14).
 *
 * Lecture ouverte à tout membre — un client voit le travail qui le concerne —
 * mais écriture réservée à l'agence. Décision assumée : une tâche est un
 * engagement de production, pas un fil de discussion ; laisser un client
 * réassigner ou annuler une tâche rendrait le suivi interne inutilisable. Le
 * client dispose du commentaire et de la validation pour s'exprimer.
 */
@Controller('tasks')
@UseGuards(AuthGuard)
export class TasksController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  @Get()
  @MinRole('VIEWER')
  async list(
    @Req() request: AuthedRequest,
    @Query(new ZodPipe(taskQuerySchema)) query: TaskQuery,
  ): Promise<Task[]> {
    return (await this.tasks.list(this.org(request), query)).map((task) => taskSchema.parse(task));
  }

  @Post()
  @MinRole('EDITOR')
  async create(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(createTaskSchema)) body: CreateTaskInput,
  ): Promise<Task> {
    return taskSchema.parse(await this.tasks.create(this.org(request), request.auth!.userId, body));
  }

  @Patch(':id')
  @MinRole('EDITOR')
  async update(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(updateTaskSchema)) body: UpdateTaskInput,
  ): Promise<Task> {
    return taskSchema.parse(await this.tasks.update(this.org(request), id, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @MinRole('EDITOR')
  async remove(@Req() request: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.tasks.remove(this.org(request), id);
  }

  private org(request: AuthedRequest): string {
    if (!request.auth?.organizationId) {
      throw new NotFoundException('Organisation active requise (X-Organization-Id)');
    }
    return request.auth.organizationId;
  }
}
