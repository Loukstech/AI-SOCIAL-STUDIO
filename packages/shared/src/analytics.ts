import { z } from 'zod';
import { socialPlatformSchema } from './social.js';

/**
 * Analytics (§13).
 *
 * La règle du cahier des charges tient en une phrase : « Ne jamais inventer ou
 * extrapoler une métrique indisponible. Afficher sa provenance, sa date de
 * synchronisation et son éventuelle indisponibilité. »
 *
 * Elle se traduit ici par trois choix non négociables :
 *
 * 1. **`null` n'est pas `0`.** Une métrique non fournie vaut `null` ; zéro
 *    signifie « mesurée à zéro ». Les confondre reviendrait à inventer.
 * 2. **La provenance accompagne chaque chiffre** (`MANUAL`, `PLATFORM_API`,
 *    `WEBHOOK`) et chaque agrégat expose combien de mesures l'ont alimenté.
 * 3. **Un taux n'est calculé que si son calcul a un sens.** Sans toutes ses
 *    composantes et sans dénominateur d'audience, il reste `null` avec le
 *    motif — jamais une estimation.
 */

// --- Champs mesurables ---

export const metricFields = [
  'views',
  'impressions',
  'reach',
  'likes',
  'comments',
  'shares',
  'saves',
  'clicks',
] as const;
export type MetricField = (typeof metricFields)[number];

export const metricLabels: Record<MetricField, string> = {
  views: 'Vues',
  impressions: 'Impressions',
  reach: 'Portée',
  likes: 'Likes',
  comments: 'Commentaires',
  shares: 'Partages',
  saves: 'Enregistrements',
  clicks: 'Clics',
};

/**
 * Champs qui ne s'additionnent pas sans précaution.
 *
 * La portée compte des **personnes** : additionner celle de deux publications
 * recompte celles qui ont vu les deux. La valeur reste exposée — elle est
 * utile — mais signalée comme non dédupliquée.
 */
export const nonAdditiveFields: MetricField[] = ['reach'];

/** Composantes du taux d'engagement : les quatre sont exigées. */
export const engagementComponents: MetricField[] = ['likes', 'comments', 'shares', 'saves'];

export type MetricBag = Partial<Record<MetricField, number | null>>;

/** Au moins une métrique réellement fournie ? */
export function hasAnyMetric(values: MetricBag): boolean {
  return metricFields.some((field) => {
    const value = values[field];
    return typeof value === 'number' && Number.isFinite(value);
  });
}

/** Nombre de métriques fournies dans une mesure. */
export function countMetrics(values: MetricBag): number {
  return metricFields.filter((field) => typeof values[field] === 'number').length;
}

// --- Taux d'engagement ---

export interface EngagementResult {
  /** `null` quand le calcul n'a pas de sens — jamais une estimation. */
  value: number | null;
  /** Dénominateur réellement utilisé, pour l'afficher tel quel. */
  basis: 'impressions' | 'reach' | null;
  /** Motif de l'indisponibilité, `null` quand la valeur est calculée. */
  reason: string | null;
  /** Nombre de mesures ayant servi au calcul (1 pour une mesure isolée). */
  basedOn: number;
}

/**
 * Taux d'engagement = interactions / audience.
 *
 * Les quatre composantes sont exigées : avec un numérateur partiel, le taux
 * serait mécaniquement sous-estimé et présenterait une contre-performance
 * inexistante. Le dénominateur est celui que la plateforme fournit réellement,
 * et il est nommé.
 */
export function engagementRate(values: MetricBag): EngagementResult {
  const missing = engagementComponents.filter((field) => typeof values[field] !== 'number');
  if (missing.length > 0) {
    return {
      value: null,
      basis: null,
      basedOn: 0,
      reason: `Composantes manquantes : ${missing.map((field) => metricLabels[field]).join(', ')}`,
    };
  }

  const interactions = engagementComponents.reduce(
    (total, field) => total + (values[field] ?? 0),
    0,
  );
  const impressions = values.impressions;
  if (typeof impressions === 'number' && impressions > 0) {
    return { value: interactions / impressions, basis: 'impressions', basedOn: 1, reason: null };
  }
  const reach = values.reach;
  if (typeof reach === 'number' && reach > 0) {
    return { value: interactions / reach, basis: 'reach', basedOn: 1, reason: null };
  }
  return {
    value: null,
    basis: null,
    basedOn: 0,
    reason: 'Aucun dénominateur d’audience : impressions et portée sont indisponibles ou nulles',
  };
}

// --- Agrégation ---

export interface MetricAggregate {
  /** Somme des valeurs fournies, `null` si personne ne l'a fournie. */
  value: number | null;
  /** Nombre de mesures ayant fourni cette métrique. */
  contributors: number;
}

/**
 * Additionne champ par champ, en ignorant les absences.
 *
 * `contributors` permet à l'interface de dire « 12 mesures sur 20 » : un total
 * partiel présenté comme complet serait une extrapolation.
 */
export function sumMetrics(measurements: MetricBag[]): Record<MetricField, MetricAggregate> {
  const result = {} as Record<MetricField, MetricAggregate>;
  for (const field of metricFields) {
    let value: number | null = null;
    let contributors = 0;
    for (const measurement of measurements) {
      const candidate = measurement[field];
      if (typeof candidate !== 'number') continue;
      value = (value ?? 0) + candidate;
      contributors += 1;
    }
    result[field] = { value, contributors };
  }
  return result;
}

/**
 * Taux d'engagement d'un ensemble de mesures.
 *
 * Seules les mesures **complètes** entrent dans le calcul : celles qui portent
 * les quatre composantes et un dénominateur d'audience. Les autres sont
 * écartées — et `basedOn` dit combien ont servi. Calculer sur un sous-ensemble
 * sans le dire serait une extrapolation.
 */
export function pooledEngagement(
  measurements: MetricBag[],
): EngagementResult & { basedOn: number } {
  const complete = measurements.filter((measurement) => {
    const hasAll = engagementComponents.every((field) => typeof measurement[field] === 'number');
    const impressions = measurement.impressions;
    const reach = measurement.reach;
    const hasBasis =
      (typeof impressions === 'number' && impressions > 0) ||
      (typeof reach === 'number' && reach > 0);
    return hasAll && hasBasis;
  });

  if (complete.length === 0) {
    return {
      value: null,
      basis: null,
      basedOn: 0,
      reason:
        'Aucune mesure complète : il faut les quatre interactions et les impressions (ou la portée) pour calculer un taux',
    };
  }

  const totals = sumMetrics(complete);
  const bag: MetricBag = {};
  for (const field of metricFields) bag[field] = totals[field].value;
  return { ...engagementRate(bag), basedOn: complete.length };
}

/** Avertissements d'agrégation, à afficher avec les chiffres. */
export function aggregationNotes(measurements: MetricBag[]): string[] {
  const notes: string[] = [];
  const present = metricFields.filter((field) =>
    measurements.some((measurement) => typeof measurement[field] === 'number'),
  );
  const partial = metricFields.filter((field) => {
    const contributors = measurements.filter(
      (measurement) => typeof measurement[field] === 'number',
    ).length;
    return contributors > 0 && contributors < measurements.length;
  });
  if (partial.length > 0) {
    notes.push(
      `Totaux partiels : ${partial.map((field) => metricLabels[field]).join(', ')} ne sont pas renseignés par toutes les mesures.`,
    );
  }
  if (present.includes('reach') && measurements.length > 1) {
    notes.push(
      'La portée est additionnée sans déduplication : une même personne peut être comptée sur plusieurs publications.',
    );
  }
  if (present.length === 0) {
    notes.push('Aucune métrique n’est disponible sur cette période.');
  }
  return notes;
}

// --- Contrats d'API ---

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Date ISO attendue');
const nonNegativeInt = z.number().int().min(0).max(2_000_000_000);

export const metricSourceSchema = z.enum(['MANUAL', 'PLATFORM_API', 'WEBHOOK']);
export type MetricSource = z.infer<typeof metricSourceSchema>;

export const metricSourceLabels: Record<MetricSource, string> = {
  MANUAL: 'Saisie manuelle',
  PLATFORM_API: 'API de la plateforme',
  WEBHOOK: 'Transport de publication',
};

/** Métrique de classement des meilleurs contenus : jamais devinée. */
export const rankingSchema = z.enum(['ENGAGEMENT', 'VIEWS', 'IMPRESSIONS', 'INTERACTIONS']);
export type Ranking = z.infer<typeof rankingSchema>;

/** Saisie d'une mesure : au moins une métrique, jamais de valeur négative. */
const metricValuesObject = z.object({
  collectedAt: isoDate.optional(),
  note: z.string().trim().max(500).optional(),
  views: nonNegativeInt.nullable().optional(),
  impressions: nonNegativeInt.nullable().optional(),
  reach: nonNegativeInt.nullable().optional(),
  likes: nonNegativeInt.nullable().optional(),
  comments: nonNegativeInt.nullable().optional(),
  shares: nonNegativeInt.nullable().optional(),
  saves: nonNegativeInt.nullable().optional(),
  clicks: nonNegativeInt.nullable().optional(),
});

const atLeastOneMetric = { message: 'Au moins une métrique doit être renseignée' };

export const recordMetricSchema = metricValuesObject.refine(
  (value) => hasAnyMetric(value),
  atLeastOneMetric,
);
export type RecordMetricInput = z.infer<typeof recordMetricSchema>;

/** Corps complet de la route de saisie : la cible fait partie de la requête. */
export const recordMeasurementSchema = metricValuesObject
  .extend({
    publicationId: z.string().min(1),
    targetId: z.string().min(1),
  })
  .refine((value) => hasAnyMetric(value), atLeastOneMetric);
export type RecordMeasurementInput = z.infer<typeof recordMeasurementSchema>;

export const measurementSchema = z.object({
  id: z.string(),
  targetId: z.string(),
  platform: socialPlatformSchema,
  source: metricSourceSchema,
  collectedAt: z.string(),
  syncedAt: z.string(),
  note: z.string().nullable(),
  views: z.number().nullable(),
  impressions: z.number().nullable(),
  reach: z.number().nullable(),
  likes: z.number().nullable(),
  comments: z.number().nullable(),
  shares: z.number().nullable(),
  saves: z.number().nullable(),
  clicks: z.number().nullable(),
});
export type Measurement = z.infer<typeof measurementSchema>;

const metricAggregateSchema = z.object({
  value: z.number().nullable(),
  contributors: z.number(),
});

const metricsSchema = z.object(
  Object.fromEntries(metricFields.map((field) => [field, metricAggregateSchema])) as {
    [K in MetricField]: typeof metricAggregateSchema;
  },
);

export const engagementSchema = z.object({
  value: z.number().nullable(),
  basis: z.enum(['impressions', 'reach']).nullable(),
  reason: z.string().nullable(),
  basedOn: z.number(),
});

export const networkAnalyticsSchema = z.object({
  platform: socialPlatformSchema,
  label: z.string(),
  /** Publications distinctes disposant d'au moins une mesure. */
  publications: z.number(),
  measurements: z.number(),
  metrics: metricsSchema,
  engagement: engagementSchema,
  lastCollectedAt: z.string().nullable(),
});
export type NetworkAnalytics = z.infer<typeof networkAnalyticsSchema>;

export const analyticsQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  brandId: z.string().min(1).optional(),
  platform: socialPlatformSchema.optional(),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const analyticsOverviewSchema = z.object({
  from: z.string(),
  to: z.string(),
  timezone: z.string(),
  generatedAt: z.string(),
  /** Publications publiées dans la période. */
  publications: z.number(),
  /** Dont celles qui disposent d'au moins une mesure. */
  measured: z.number(),
  networks: z.array(networkAnalyticsSchema),
  totals: metricsSchema,
  engagement: engagementSchema,
  sources: z.array(
    z.object({
      source: metricSourceSchema,
      measurements: z.number(),
      lastSyncedAt: z.string().nullable(),
    }),
  ),
  /** Limites du calcul, affichées à côté des chiffres. */
  notes: z.array(z.string()),
  /** §13 « évolution de l'audience si disponible » : dit qu'elle ne l'est pas. */
  audience: z.object({ available: z.boolean(), reason: z.string() }),
});
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;

export const topPublicationSchema = z.object({
  publicationId: z.string(),
  targetId: z.string(),
  title: z.string().nullable(),
  brandId: z.string().nullable(),
  platform: socialPlatformSchema,
  username: z.string(),
  publishedAt: z.string().nullable(),
  externalUrl: z.string().nullable(),
  metrics: metricsSchema,
  engagement: engagementSchema,
  source: metricSourceSchema,
  collectedAt: z.string(),
});
export type TopPublication = z.infer<typeof topPublicationSchema>;

export const topPublicationsSchema = z.object({
  items: z.array(topPublicationSchema),
  total: z.number(),
  /** Métrique de classement, explicitement nommée. */
  rankedBy: rankingSchema,
  notes: z.array(z.string()),
});
export type TopPublications = z.infer<typeof topPublicationsSchema>;

/** Résultat d'une tentative de collecte auprès des plateformes. */
export const collectResultSchema = z.object({
  attempted: z.number(),
  collected: z.number(),
  skipped: z.array(
    z.object({
      targetId: z.string(),
      platform: socialPlatformSchema,
      reason: z.string(),
    }),
  ),
});
export type CollectResult = z.infer<typeof collectResultSchema>;

// --- Export CSV ---

/** Nombre pour le CSV : vide quand la métrique est indisponible, jamais `0`. */
export function csvNumber(value: number | null | undefined): string {
  return typeof value === 'number' ? String(value) : '';
}

/** Échappe une cellule CSV (`;` séparateur, guillemets doublés). */
export function csvCell(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Assemble le CSV. Séparateur `;` et BOM UTF-8 : c'est ce qu'attend Excel en
 * configuration française, et sans BOM les accents sortent cassés.
 */
export function toCsv(rows: string[][]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
