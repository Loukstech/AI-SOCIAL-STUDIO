import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  historyQuerySchema,
  historySchema,
  portfolioSchema,
  type History,
  type HistoryQuery,
  type OrganizationRole,
  type Portfolio,
} from '@ass/shared';
import { ZodPipe } from '../common/validation.js';
import { AuthGuard, MinRole } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';
import { HistoryService } from './history.service.js';
import { PortfolioService } from './portfolio.service.js';

/**
 * Les deux lectures transversales du §14 : l'historique d'un contenu et le
 * portefeuille de clients.
 *
 * Le portefeuille est la seule route qui n'exige pas d'organisation active :
 * il porte justement sur *plusieurs* organisations. Il ne liste néanmoins que
 * celles où l'utilisateur est membre — l'énumération des tenants n'est jamais
 * une information publique.
 */
@Controller()
@UseGuards(AuthGuard)
export class CollaborationController {
  constructor(
    @Inject(HistoryService) private readonly history: HistoryService,
    @Inject(PortfolioService) private readonly portfolio: PortfolioService,
  ) {}

  @Get('publications/:id/history')
  @MinRole('VIEWER')
  async publicationHistory(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Query(new ZodPipe(historyQuerySchema)) query: HistoryQuery,
  ): Promise<History> {
    const { organizationId, role } = this.identity(request);
    return historySchema.parse(
      await this.history.forPublication(organizationId, role, id, query.limit),
    );
  }

  @Get('portfolio')
  async overview(@Req() request: AuthedRequest): Promise<Portfolio> {
    return portfolioSchema.parse(await this.portfolio.overview(request.auth!.userId));
  }

  private identity(request: AuthedRequest): { organizationId: string; role: OrganizationRole } {
    if (!request.auth?.organizationId) {
      throw new NotFoundException('Organisation active requise (X-Organization-Id)');
    }
    return { organizationId: request.auth.organizationId, role: request.auth.role };
  }
}
