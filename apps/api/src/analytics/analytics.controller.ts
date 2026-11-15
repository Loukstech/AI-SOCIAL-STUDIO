import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  analyticsOverviewSchema,
  analyticsQuerySchema,
  collectResultSchema,
  measurementSchema,
  rankingSchema,
  recordMeasurementSchema,
  topPublicationsSchema,
  z,
  type AnalyticsOverview,
  type AnalyticsQuery,
  type CollectResult,
  type Measurement,
  type Ranking,
  type RecordMeasurementInput,
  type TopPublications,
} from '@ass/shared';
import { Db, ZodPipe } from '../common/validation.js';
import { AuthGuard, MinRole } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';
import { AnalyticsService } from './analytics.service.js';

const topQuerySchema = analyticsQuerySchema.extend({
  rankedBy: rankingSchema.default('ENGAGEMENT'),
});

/**
 * Analytics (§13).
 *
 * Toutes les routes sont en lecture sauf la saisie d'une mesure, réservée aux
 * éditeurs : un rapport n'est pas modifiable, une mesure est une donnée qu'on
 * engage.
 */
@Controller('analytics')
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
  ) {}

  @Get('overview')
  @MinRole('VIEWER')
  async overview(
    @Req() request: AuthedRequest,
    @Query(new ZodPipe(analyticsQuerySchema)) query: AnalyticsQuery,
  ): Promise<AnalyticsOverview> {
    return analyticsOverviewSchema.parse(await this.analytics.overview(this.org(request), query));
  }

  /** Meilleurs contenus. La métrique de classement est explicite, jamais devinée. */
  @Get('top')
  @MinRole('VIEWER')
  async top(
    @Req() request: AuthedRequest,
    @Query(new ZodPipe(topQuerySchema)) query: AnalyticsQuery & { rankedBy: Ranking },
  ): Promise<TopPublications> {
    return topPublicationsSchema.parse(
      await this.analytics.top(this.org(request), query, query.rankedBy),
    );
  }

  /**
   * Export CSV. Le nom de fichier est daté : le téléchargement reste
   * identifiable dans un dossier de rapports.
   */
  @Get('export.csv')
  @MinRole('VIEWER')
  async export(
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) response: Response,
    @Query(new ZodPipe(analyticsQuerySchema)) query: AnalyticsQuery,
  ): Promise<string> {
    const csv = await this.analytics.exportCsv(this.org(request), query);
    const stamp = new Date().toISOString().slice(0, 10);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="analytics-${stamp}.csv"; filename*=UTF-8''analytics-${stamp}.csv`,
    );
    return csv;
  }

  @Get('measurements')
  @MinRole('VIEWER')
  async measurements(
    @Req() request: AuthedRequest,
    @Query('publicationId') publicationId?: string,
    @Query('targetId') targetId?: string,
  ): Promise<Measurement[]> {
    if (!publicationId || !targetId) {
      throw new BadRequestException('`publicationId` et `targetId` sont requis');
    }
    return z
      .array(measurementSchema)
      .parse(await this.analytics.history(this.org(request), publicationId, targetId));
  }

  /** Saisie d'une mesure relevée sur la plateforme. */
  @Post('measurements')
  @HttpCode(201)
  @MinRole('EDITOR')
  async record(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(recordMeasurementSchema)) body: RecordMeasurementInput,
  ): Promise<Measurement> {
    return measurementSchema.parse(
      await this.analytics.record(
        this.org(request),
        request.auth!.userId,
        body.publicationId,
        body.targetId,
        body,
      ),
    );
  }

  /**
   * Collecte auprès des plateformes. Sans adaptateur natif, la réponse liste
   * les cibles ignorées **et leur motif** : aucun chiffre n'est inventé.
   */
  @Post('collect')
  @HttpCode(200)
  @MinRole('EDITOR')
  async collect(@Req() request: AuthedRequest): Promise<CollectResult> {
    return collectResultSchema.parse(await this.analytics.collect(this.org(request)));
  }

  private org(request: AuthedRequest): string {
    if (!request.auth?.organizationId) {
      throw new NotFoundException('Organisation active requise (X-Organization-Id)');
    }
    return request.auth.organizationId;
  }
}
