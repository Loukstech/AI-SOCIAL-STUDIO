import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  aggregationNotes,
  countMetrics,
  engagementRate,
  hasAnyMetric,
  metricFields,
  metricLabels,
  metricSourceLabels,
  platformSpecs,
  pooledEngagement,
  socialPlatformSchema,
  sumMetrics,
  toCsv,
  csvNumber,
  type AnalyticsOverview,
  type AnalyticsQuery,
  type CollectResult,
  type Measurement,
  type MetricBag,
  type MetricField,
  type MetricSource,
  type RecordMetricInput,
  type TopPublication,
  type TopPublications,
} from '@ass/shared';
import { Db } from '../common/validation.js';
import { ENV, type Env } from '../config/env.js';
import { createConnector } from '../publishing/connectors.js';

/**
 * Analytics (§13).
 *
 * Trois règles gouvernent ce service, reprises du cahier des charges :
 *
 * - **Aucune métrique n'est inventée.** Une valeur absente reste `null` de bout
 *   en bout ; l'agrégat dit combien de mesures l'ont alimentée.
 * - **La provenance et la date accompagnent chaque chiffre.** Une saisie
 *   manuelle n'est pas une lecture d'API, et l'interface doit pouvoir le dire.
 * - **Une seule mesure par publication est retenue** (la plus récente de la
 *   période) : les compteurs des réseaux sont cumulatifs, les additionner
 *   reviendrait à compter plusieurs fois les mêmes vues.
 */

/** Période par défaut : les 30 derniers jours. */
const DEFAULT_WINDOW_DAYS = 30;
/** Garde-fou : au-delà d'un an, la requête n'a plus de sens métier. */
const MAX_WINDOW_DAYS = 366;

interface MeasurementRow {
  id: string;
  targetId: string;
  platform: string;
  source: string;
  collectedAt: Date;
  syncedAt: Date;
  note: string | null;
  views: number | null;
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  target: {
    socialAccount: { username: string };
    publication: {
      id: string;
      title: string | null;
      brandId: string | null;
      publishedAt: Date | null;
      deletedAt: Date | null;
    };
  };
}

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // --- Vue d'ensemble ---

  async overview(organizationId: string, query: AnalyticsQuery): Promise<AnalyticsOverview> {
    const organization = await this.organization(organizationId);
    const window = resolveWindow(query);
    const rows = await this.measurementsIn(organizationId, window, query);

    // Une seule mesure par cible : la plus récente de la période.
    const latest = latestByTarget(rows);
    const bags = latest.map((row) => toBag(row));
    const totals = sumMetrics(bags);

    const byPlatform = new Map<string, MeasurementRow[]>();
    for (const row of latest) {
      const list = byPlatform.get(row.platform) ?? [];
      list.push(row);
      byPlatform.set(row.platform, list);
    }

    const published = await this.db.client.publication.count({
      where: {
        organizationId,
        deletedAt: null,
        status: 'PUBLISHED',
        ...(query.brandId ? { brandId: query.brandId } : {}),
        publishedAt: { gte: window.from, lte: window.to },
      },
    });

    const networks = [...byPlatform.entries()]
      .map(([platform, list]) => {
        const platformBags = list.map((row) => toBag(row));
        const metrics = sumMetrics(platformBags);
        // Seules les mesures complètes alimentent le taux ; `basedOn` dit combien.
        const pooled = pooledEngagement(platformBags);
        return {
          platform: socialPlatformSchema.parse(platform),
          label: platformSpecs[socialPlatformSchema.parse(platform)].label,
          publications: new Set(list.map((row) => row.target.publication.id)).size,
          measurements: list.length,
          metrics,
          engagement: pooled,
          lastCollectedAt: isoOrNull(maxDate(list.map((row) => row.collectedAt))),
        };
      })
      .sort((a, b) => (b.metrics.impressions.value ?? 0) - (a.metrics.impressions.value ?? 0));

    const sources = await this.sourceSummary(organizationId, window);

    const notes = aggregationNotes(bags);
    if (rows.length > latest.length) {
      notes.push(
        `Plusieurs mesures existent pour certaines publications : seule la plus récente est retenue, pour ne pas additionner des compteurs cumulatifs.`,
      );
    }
    if (published > latest.length) {
      notes.push(
        `${published - latest.length} publication(s) publiée(s) sur la période n’ont aucune mesure : elles ne sont pas comptées dans les totaux.`,
      );
    }

    return {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      timezone: organization.timezone,
      generatedAt: new Date().toISOString(),
      publications: published,
      measured: new Set(latest.map((row) => row.target.publication.id)).size,
      networks,
      totals,
      engagement: pooledEngagement(bags),
      sources,
      notes,
      audience: {
        available: false,
        reason:
          'Aucune série d’audience (abonnés) n’est collectée : les API des réseaux l’exigent par appel dédié, et aucun adaptateur natif n’est configuré. La donnée n’est donc pas affichée plutôt qu’estimée.',
      },
    };
  }

  // --- Meilleurs contenus ---

  async top(
    organizationId: string,
    query: AnalyticsQuery,
    rankedBy: TopPublications['rankedBy'] = 'ENGAGEMENT',
  ): Promise<TopPublications> {
    const window = resolveWindow(query);
    const rows = latestByTarget(await this.measurementsIn(organizationId, window, query));

    const items: TopPublication[] = rows.map((row) => {
      const bag = toBag(row);
      return {
        publicationId: row.target.publication.id,
        targetId: row.targetId,
        title: row.target.publication.title,
        brandId: row.target.publication.brandId,
        platform: socialPlatformSchema.parse(row.platform),
        username: row.target.socialAccount.username,
        publishedAt: isoOrNull(row.target.publication.publishedAt),
        externalUrl: null,
        metrics: sumMetrics([bag]),
        engagement: engagementRate(bag),
        source: row.source as MetricSource,
        collectedAt: row.collectedAt.toISOString(),
      };
    });

    const scored = items.filter((item) => rankingValue(item, rankedBy) !== null);
    scored.sort((a, b) => (rankingValue(b, rankedBy) ?? 0) - (rankingValue(a, rankedBy) ?? 0));

    const notes: string[] = [];
    const excluded = items.length - scored.length;
    if (excluded > 0) {
      notes.push(
        `${excluded} publication(s) mesurée(s) sont écartées de ce classement : la métrique de classement y est indisponible.`,
      );
    }
    if (rankedBy === 'ENGAGEMENT') {
      notes.push(
        'Le taux d’engagement exige les quatre composantes (likes, commentaires, partages, enregistrements) et un dénominateur d’audience.',
      );
    }

    return { items: scored.slice(0, 50), total: scored.length, rankedBy, notes };
  }

  // --- Export ---

  /**
   * CSV d'une ligne par mesure — pas une ligne par publication : l'export sert
   * aussi à vérifier la traçabilité (source, dates) dans un tableur.
   */
  async exportCsv(organizationId: string, query: AnalyticsQuery): Promise<string> {
    const window = resolveWindow(query);
    const rows = await this.measurementsIn(organizationId, window, query);
    const brands = await this.brandNames(organizationId);

    const header = [
      'Publication',
      'Titre',
      'Marque',
      'Réseau',
      'Compte',
      'Publié le',
      'Mesuré le',
      'Enregistré le',
      'Source',
      ...metricFields.map((field) => metricLabels[field]),
      'Note',
    ];

    const body = rows.map((row) => [
      row.target.publication.id,
      row.target.publication.title ?? '',
      row.target.publication.brandId ? (brands.get(row.target.publication.brandId) ?? '') : '',
      row.platform,
      row.target.socialAccount.username,
      isoOrNull(row.target.publication.publishedAt) ?? '',
      row.collectedAt.toISOString(),
      row.syncedAt.toISOString(),
      metricSourceLabels[row.source as MetricSource] ?? row.source,
      ...metricFields.map((field) => csvNumber(row[field])),
      row.note ?? '',
    ]);

    return toCsv([header, ...body]);
  }

  // --- Saisie et historique ---

  /** Enregistre une mesure. Seule une cible publiée peut être mesurée. */
  async record(
    organizationId: string,
    actorId: string,
    publicationId: string,
    targetId: string,
    input: RecordMetricInput,
  ): Promise<Measurement> {
    const target = await this.db.client.publicationTarget.findFirst({
      where: {
        id: targetId,
        publicationId,
        publication: { organizationId, deletedAt: null },
      },
      include: { publication: { select: { id: true } } },
    });
    if (!target) throw new NotFoundException('Cible de publication introuvable');
    if (target.status !== 'PUBLISHED') {
      throw new BadRequestException(
        'Une publication non publiée ne peut pas être mesurée : confirmez d’abord la publication',
      );
    }

    const row = await this.db.client.publicationMetric.create({
      data: {
        organizationId,
        targetId: target.id,
        platform: target.platform,
        source: 'MANUAL',
        collectedAt: input.collectedAt ? new Date(input.collectedAt) : new Date(),
        recordedById: actorId,
        ...(input.note ? { note: input.note } : {}),
        ...metricValues(input),
      },
    });

    await this.db.client.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'analytics.metric_recorded',
        targetType: 'publication_target',
        targetId: target.id,
        metadata: { platform: target.platform, fields: countMetrics(input) },
      },
    });

    return toMeasurement(row);
  }

  /** Historique d'une cible, du plus ancien au plus récent. */
  async history(
    organizationId: string,
    publicationId: string,
    targetId: string,
  ): Promise<Measurement[]> {
    const rows = await this.db.client.publicationMetric.findMany({
      where: {
        organizationId,
        targetId,
        target: { publicationId, publication: { organizationId, deletedAt: null } },
      },
      orderBy: [{ collectedAt: 'asc' }, { syncedAt: 'asc' }],
    });
    return rows.map(toMeasurement);
  }

  // --- Collecte auprès des plateformes ---

  /**
   * Tente de récupérer les statistiques auprès des plateformes.
   *
   * Sans adaptateur natif configuré, chaque cible est **ignorée avec son
   * motif** : l'endpoint ne fabrique aucun chiffre et le dit. Il deviendra
   * fonctionnel quand les identifiants d'application seront renseignés.
   */
  async collect(organizationId: string): Promise<CollectResult> {
    const targets = await this.db.client.publicationTarget.findMany({
      where: { publication: { organizationId, deletedAt: null }, status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
      take: 100,
      include: { socialAccount: { select: { username: true } } },
    });

    const skipped: CollectResult['skipped'] = [];
    let collected = 0;

    for (const target of targets) {
      const platform = socialPlatformSchema.parse(target.platform);
      const connector = createConnector(this.env, platform);
      const result = await connector.getAnalytics(target.externalId ?? target.id);
      if (!result.ok || !result.metrics) {
        skipped.push({
          targetId: target.id,
          platform,
          reason: result.message ?? 'Statistiques indisponibles pour cette plateforme',
        });
        continue;
      }
      const values: MetricBag = {};
      for (const field of metricFields) {
        const value = result.metrics[field];
        if (typeof value === 'number') values[field] = value;
      }
      if (!hasAnyMetric(values)) {
        skipped.push({
          targetId: target.id,
          platform,
          reason: 'La plateforme n’a renvoyé aucune métrique exploitable',
        });
        continue;
      }
      await this.db.client.publicationMetric.create({
        data: {
          organizationId,
          targetId: target.id,
          platform,
          source: 'PLATFORM_API',
          collectedAt: new Date(),
          ...metricValues(values),
        },
      });
      collected += 1;
    }

    return { attempted: targets.length, collected, skipped };
  }

  // --- Aides ---

  private async organization(organizationId: string): Promise<{ timezone: string }> {
    const organization = await this.db.client.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    if (!organization) throw new NotFoundException('Organisation introuvable');
    return organization;
  }

  private async brandNames(organizationId: string): Promise<Map<string, string>> {
    const rows = await this.db.client.brand.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private async measurementsIn(
    organizationId: string,
    window: { from: Date; to: Date },
    query: AnalyticsQuery,
  ): Promise<MeasurementRow[]> {
    const publicationFilter = {
      organizationId,
      deletedAt: null,
      ...(query.brandId ? { brandId: query.brandId } : {}),
    };
    const rows = await this.db.client.publicationMetric.findMany({
      where: {
        organizationId,
        collectedAt: { gte: window.from, lte: window.to },
        ...(query.platform ? { platform: query.platform } : {}),
        target: { publication: publicationFilter },
      },
      include: {
        target: {
          select: {
            socialAccount: { select: { username: true } },
            publication: {
              select: { id: true, title: true, brandId: true, publishedAt: true, deletedAt: true },
            },
          },
        },
      },
      orderBy: [{ collectedAt: 'asc' }, { syncedAt: 'asc' }],
    });
    return rows as unknown as MeasurementRow[];
  }

  private async sourceSummary(
    organizationId: string,
    window: { from: Date; to: Date },
  ): Promise<AnalyticsOverview['sources']> {
    const rows = await this.db.client.publicationMetric.groupBy({
      by: ['source'],
      where: { organizationId, collectedAt: { gte: window.from, lte: window.to } },
      _count: { _all: true },
      _max: { syncedAt: true },
    });
    return rows.map((row) => ({
      source: row.source as MetricSource,
      measurements: row._count._all,
      lastSyncedAt: isoOrNull(row._max.syncedAt ?? null),
    }));
  }
}

// --- Fonctions pures, exportées pour les tests ---

export interface Window {
  from: Date;
  to: Date;
}

/** Période demandée, ou les 30 derniers jours. Refuse une période inversée. */
export function resolveWindow(query: AnalyticsQuery, now = new Date()): Window {
  const to = query.to ? new Date(query.to) : now;
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);
  if (from.getTime() > to.getTime()) {
    throw new BadRequestException('La période est inversée : `from` doit précéder `to`');
  }
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * 86_400_000) {
    throw new BadRequestException(`La période ne peut pas dépasser ${MAX_WINDOW_DAYS} jours`);
  }
  return { from, to };
}

/** Garde la mesure la plus récente par cible (les compteurs sont cumulatifs). */
export function latestByTarget<T extends { targetId: string; collectedAt: Date; syncedAt: Date }>(
  rows: T[],
): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const current = best.get(row.targetId);
    if (
      !current ||
      row.collectedAt.getTime() > current.collectedAt.getTime() ||
      (row.collectedAt.getTime() === current.collectedAt.getTime() &&
        row.syncedAt.getTime() > current.syncedAt.getTime())
    ) {
      best.set(row.targetId, row);
    }
  }
  return [...best.values()];
}

export function toBag(row: MetricBag): MetricBag {
  const bag: MetricBag = {};
  for (const field of metricFields) {
    const value = row[field];
    if (typeof value === 'number') bag[field] = value;
  }
  return bag;
}

/**
 * Taux d'engagement d'un agrégat : rapport des sommes, jamais moyenne des taux.
 *
 * Le calcul lui-même vit dans `@ass/shared` (`pooledEngagement`) pour que
 * l'API, le front et les tests partagent exactement la même règle : seules les
 * mesures complètes comptent, et `basedOn` dit combien.
 */
function rankingValue(item: TopPublication, rankedBy: TopPublications['rankedBy']): number | null {
  if (rankedBy === 'ENGAGEMENT') return item.engagement.value;
  const field: MetricField =
    rankedBy === 'VIEWS' ? 'views' : rankedBy === 'IMPRESSIONS' ? 'impressions' : 'likes';
  if (rankedBy === 'INTERACTIONS') {
    const components = ['likes', 'comments', 'shares', 'saves'] as const;
    const values = components.map((name) => item.metrics[name].value);
    return values.some((value) => value === null)
      ? null
      : values.reduce<number>((total, value) => total + (value ?? 0), 0);
  }
  return item.metrics[field].value;
}

function metricValues(input: MetricBag): Record<string, number> {
  const data: Record<string, number> = {};
  for (const field of metricFields) {
    const value = input[field];
    if (typeof value === 'number') data[field] = value;
  }
  return data;
}

function maxDate(dates: Date[]): Date | null {
  if (dates.length === 0) return null;
  return dates.reduce((latest, date) => (date.getTime() > latest.getTime() ? date : latest));
}

function isoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function toMeasurement(row: {
  id: string;
  targetId: string;
  platform: string;
  source: string;
  collectedAt: Date;
  syncedAt: Date;
  note: string | null;
  views: number | null;
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
}): Measurement {
  return {
    id: row.id,
    targetId: row.targetId,
    platform: socialPlatformSchema.parse(row.platform),
    source: row.source as MetricSource,
    collectedAt: row.collectedAt.toISOString(),
    syncedAt: row.syncedAt.toISOString(),
    note: row.note,
    views: row.views,
    impressions: row.impressions,
    reach: row.reach,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    saves: row.saves,
    clicks: row.clicks,
  };
}
