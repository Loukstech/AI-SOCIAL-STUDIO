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
  cancelPublicationSchema,
  confirmPublicationSchema,
  createPublicationSchema,
  duplicatePublicationSchema,
  publicationQuerySchema,
  rejectPublicationSchema,
  reviewerRoles,
  schedulePublicationSchema,
  updatePublicationSchema,
  type CancelPublicationInput,
  type ConfirmPublicationInput,
  type CreatePublicationInput,
  type DuplicatePublicationInput,
  type PublicationDetail,
  type PublicationExport,
  type PublicationList,
  type PublicationQuery,
  type PublishingReadiness,
  type RejectPublicationInput,
  type SchedulePublicationInput,
  type UpdatePublicationInput,
} from '@ass/shared';
import { ZodPipe } from '../common/validation.js';
import { AuthGuard, MinRole, OnlyRoles } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';
import { PublicationsService } from './publications.service.js';

/**
 * Publishing Center (§10). Chaque transition a sa propre route : le client ne
 * peut pas forcer un état, il demande une action nommée.
 */
@Controller('publications')
@UseGuards(AuthGuard)
export class PublicationsController {
  constructor(@Inject(PublicationsService) private readonly publications: PublicationsService) {}

  @Get()
  @MinRole('VIEWER')
  async list(
    @Req() request: AuthedRequest,
    @Query(new ZodPipe(publicationQuerySchema)) query: PublicationQuery,
  ): Promise<PublicationList> {
    return this.publications.list(this.org(request), query);
  }

  /** Déclarée avant `:id` pour ne pas être capturée comme un identifiant. */
  @Get('readiness')
  @MinRole('VIEWER')
  readiness(): PublishingReadiness {
    return this.publications.readiness();
  }

  @Get(':id')
  @MinRole('VIEWER')
  async detail(@Req() request: AuthedRequest, @Param('id') id: string): Promise<PublicationDetail> {
    return this.publications.detail(this.org(request), id);
  }

  @Get(':id/export')
  @MinRole('VIEWER')
  async export(@Req() request: AuthedRequest, @Param('id') id: string): Promise<PublicationExport> {
    return this.publications.exportPayload(this.org(request), id);
  }

  /**
   * Exécute tout de suite les échéances arrivées à terme. La boucle de fond
   * fait la même chose toutes les minutes ; cette route sert au dépannage et
   * aux tests, sans attendre le prochain tick.
   */
  @Post('run-due')
  @HttpCode(200)
  @MinRole('ADMIN')
  async runDue(@Req() request: AuthedRequest): Promise<{ claimed: number; expired: number }> {
    this.org(request);
    return this.publications.claimDue();
  }

  @Post()
  @HttpCode(201)
  @MinRole('EDITOR')
  async create(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(createPublicationSchema)) body: CreatePublicationInput,
  ): Promise<PublicationDetail> {
    return this.publications.create(this.org(request), request.auth!.userId, body);
  }

  @Patch(':id')
  @MinRole('EDITOR')
  async update(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(updatePublicationSchema)) body: UpdatePublicationInput,
  ): Promise<PublicationDetail> {
    return this.publications.update(this.org(request), id, body);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @MinRole('EDITOR')
  async submit(@Req() request: AuthedRequest, @Param('id') id: string): Promise<PublicationDetail> {
    return this.publications.submit(this.org(request), id, request.auth!.userId);
  }

  @Post(':id/request-approval')
  @HttpCode(200)
  @MinRole('EDITOR')
  async requestApproval(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
  ): Promise<PublicationDetail> {
    return this.publications.requestApproval(this.org(request), id, request.auth!.userId);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @MinRole('VIEWER')
  @OnlyRoles(...reviewerRoles)
  async approve(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
  ): Promise<PublicationDetail> {
    return this.publications.approve(this.org(request), id, request.auth!.userId);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @MinRole('VIEWER')
  @OnlyRoles(...reviewerRoles)
  async reject(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(rejectPublicationSchema)) body: RejectPublicationInput,
  ): Promise<PublicationDetail> {
    return this.publications.reject(this.org(request), id, request.auth!.userId, body.reason);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @MinRole('EDITOR')
  async reopen(@Req() request: AuthedRequest, @Param('id') id: string): Promise<PublicationDetail> {
    return this.publications.reopen(this.org(request), id, request.auth!.userId);
  }

  @Post(':id/schedule')
  @HttpCode(200)
  @MinRole('EDITOR')
  async schedule(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(schedulePublicationSchema)) body: SchedulePublicationInput,
  ): Promise<PublicationDetail> {
    return this.publications.schedule(this.org(request), id, request.auth!.userId, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @MinRole('EDITOR')
  async cancel(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(cancelPublicationSchema)) body: CancelPublicationInput,
  ): Promise<PublicationDetail> {
    return this.publications.cancel(
      this.org(request),
      id,
      request.auth!.userId,
      body.reason ?? null,
    );
  }

  /** Déplacement d'échéance depuis le calendrier (glisser-déposer). */
  @Post(':id/reschedule')
  @HttpCode(200)
  @MinRole('EDITOR')
  async reschedule(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(schedulePublicationSchema)) body: SchedulePublicationInput,
  ): Promise<PublicationDetail> {
    return this.publications.reschedule(this.org(request), id, request.auth!.userId, body);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @MinRole('EDITOR')
  async publish(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
  ): Promise<PublicationDetail> {
    return this.publications.publishNow(this.org(request), id, request.auth!.userId);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @MinRole('EDITOR')
  async retry(@Req() request: AuthedRequest, @Param('id') id: string): Promise<PublicationDetail> {
    return this.publications.retry(this.org(request), id, request.auth!.userId);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @MinRole('EDITOR')
  async confirm(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(confirmPublicationSchema)) body: ConfirmPublicationInput,
  ): Promise<PublicationDetail> {
    return this.publications.confirm(this.org(request), id, request.auth!.userId, body);
  }

  @Post(':id/duplicate')
  @HttpCode(201)
  @MinRole('EDITOR')
  async duplicate(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(duplicatePublicationSchema)) body: DuplicatePublicationInput,
  ): Promise<PublicationDetail> {
    return this.publications.duplicate(
      this.org(request),
      id,
      request.auth!.userId,
      body.title ?? null,
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @MinRole('EDITOR')
  async remove(@Req() request: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.publications.remove(this.org(request), id, request.auth!.userId);
  }

  private org(request: AuthedRequest): string {
    if (!request.auth?.organizationId) {
      throw new NotFoundException('Organisation active requise (X-Organization-Id)');
    }
    return request.auth.organizationId;
  }
}
