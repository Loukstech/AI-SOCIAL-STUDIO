import { Controller, Get, Inject, NotFoundException, Query, Req, UseGuards } from '@nestjs/common';
import { calendarQuerySchema, type CalendarQuery, type CalendarResponse } from '@ass/shared';
import { ZodPipe } from '../common/validation.js';
import { AuthGuard, MinRole } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';
import { PublicationsService } from './publications.service.js';

/**
 * Content Calendar (§11). Le serveur renvoie les entrées de la fenêtre demandée
 * avec le fuseau de l'organisation : le client n'a aucune conversion à faire.
 */
@Controller('calendar')
@UseGuards(AuthGuard)
export class CalendarController {
  constructor(@Inject(PublicationsService) private readonly publications: PublicationsService) {}

  @Get()
  @MinRole('VIEWER')
  async window(
    @Req() request: AuthedRequest,
    @Query(new ZodPipe(calendarQuerySchema)) query: CalendarQuery,
  ): Promise<CalendarResponse> {
    if (!request.auth?.organizationId) {
      throw new NotFoundException('Organisation active requise (X-Organization-Id)');
    }
    return this.publications.calendarResponse(request.auth.organizationId, query);
  }
}
