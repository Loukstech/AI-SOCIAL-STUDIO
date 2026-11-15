import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  aggregationNotes,
  countMetrics,
  csvCell,
  csvNumber,
  engagementRate,
  hasAnyMetric,
  metricFields,
  pooledEngagement,
  recordMeasurementSchema,
  recordMetricSchema,
  sumMetrics,
  toCsv,
} from '@ass/shared';
import { latestByTarget, resolveWindow, toBag } from './analytics.service.js';

/**
 * Ces tests protègent une seule chose, mais elle est le cœur du §13 :
 * **aucune métrique n'est inventée**. `null` reste `null`, `0` reste `0`, et un
 * taux n'apparaît que si son calcul a un sens.
 */

describe('absence de métrique', () => {
  it('distingue « indisponible » de « mesuré à zéro »', () => {
    const zero = engagementRate({ likes: 0, comments: 0, shares: 0, saves: 0, impressions: 0 });
    expect(zero.value).toBeNull();
    expect(zero.reason).toMatch(/dénominateur/i);

    const absent = engagementRate({ likes: 0, comments: 0, shares: 0, saves: 0 });
    expect(absent.value).toBeNull();
    expect(absent.reason).toMatch(/dénominateur/i);
  });

  it('n’additionne pas une métrique absente comme si elle valait zéro', () => {
    const totals = sumMetrics([{ views: 100 }, { views: null }, {}]);
    expect(totals.views).toEqual({ value: 100, contributors: 1 });
    expect(totals.likes).toEqual({ value: null, contributors: 0 });
  });

  it('compte zéro comme une contribution réelle', () => {
    const totals = sumMetrics([{ views: 0 }, { views: 0 }]);
    expect(totals.views).toEqual({ value: 0, contributors: 2 });
  });

  it('ignore les champs non numériques', () => {
    expect(hasAnyMetric({ views: undefined })).toBe(false);
    expect(hasAnyMetric({ views: null })).toBe(false);
    expect(hasAnyMetric({ views: 0 })).toBe(true);
    expect(countMetrics({ views: 0, likes: null, shares: 3 })).toBe(2);
  });
});

describe('taux d’engagement', () => {
  it('se calcule sur les impressions quand elles existent', () => {
    const result = engagementRate({
      likes: 40,
      comments: 5,
      shares: 3,
      saves: 2,
      impressions: 1_000,
      reach: 500,
    });
    expect(result.value).toBeCloseTo(0.05, 6);
    expect(result.basis).toBe('impressions');
    expect(result.reason).toBeNull();
  });

  it('retombe sur la portée et le dit', () => {
    const result = engagementRate({ likes: 10, comments: 0, shares: 0, saves: 0, reach: 400 });
    expect(result.value).toBeCloseTo(0.025, 6);
    expect(result.basis).toBe('reach');
  });

  it('refuse de calculer avec un numérateur partiel', () => {
    const result = engagementRate({ likes: 10, comments: 2, impressions: 1_000 });
    expect(result.value).toBeNull();
    expect(result.reason).toMatch(/Partages/);
    expect(result.reason).toMatch(/Enregistrements/);
  });

  it('refuse un dénominateur nul plutôt que de diviser par zéro', () => {
    const result = engagementRate({
      likes: 5,
      comments: 0,
      shares: 0,
      saves: 0,
      impressions: 0,
      reach: 0,
    });
    expect(result.value).toBeNull();
    expect(result.reason).toMatch(/nulles/);
  });
});

describe('agrégation', () => {
  it('additionne champ par champ et compte les contributeurs', () => {
    const totals = sumMetrics([
      { views: 100, likes: 10 },
      { views: 200, likes: 20 },
      { views: 300 },
    ]);
    expect(totals.views).toEqual({ value: 600, contributors: 3 });
    expect(totals.likes).toEqual({ value: 30, contributors: 2 });
    expect(totals.clicks).toEqual({ value: null, contributors: 0 });
  });

  it('signale les totaux partiels', () => {
    const notes = aggregationNotes([{ views: 10, likes: 1 }, { views: 10 }]);
    expect(notes.join(' ')).toMatch(/Totaux partiels/);
    expect(notes.join(' ')).toMatch(/Likes/);
  });

  it('avertit que la portée n’est pas dédupliquée', () => {
    const notes = aggregationNotes([{ reach: 10 }, { reach: 20 }]);
    expect(notes.join(' ')).toMatch(/déduplication/);
  });

  it('ne signale rien pour une mesure unique complète', () => {
    const notes = aggregationNotes([
      { views: 1, impressions: 1, reach: 1, likes: 1, comments: 1, shares: 1, saves: 1, clicks: 1 },
    ]);
    expect(notes).toEqual([]);
  });

  it('dit clairement quand rien n’est disponible', () => {
    expect(aggregationNotes([{}, {}]).join(' ')).toMatch(/Aucune métrique/);
  });

  it('calcule le taux d’un agrégat sur les sommes, pas la moyenne des taux', () => {
    // Petite publication : 1 like / 10 impressions = 10 %.
    // Grosse publication : 100 likes / 10 000 impressions = 1 %.
    // Le taux agrégé vaut 101/10010 ≈ 1,009 %, pas 5,5 %.
    const pooled = pooledEngagement([
      { likes: 1, comments: 0, shares: 0, saves: 0, impressions: 10 },
      { likes: 100, comments: 0, shares: 0, saves: 0, impressions: 10_000 },
    ]);
    expect(pooled.value).toBeCloseTo(101 / 10_010, 6);
    expect(pooled.basis).toBe('impressions');
    expect(pooled.basedOn).toBe(2);
  });

  it('écarte les mesures incomplètes du taux au lieu de les compter', () => {
    // La deuxième mesure n'a ni partages ni enregistrements : l'inclure
    // sous-estimerait le taux en gonflant le dénominateur sans le numérateur.
    const pooled = pooledEngagement([
      { likes: 10, comments: 0, shares: 0, saves: 0, impressions: 100 },
      { likes: 50, comments: 5, impressions: 1_000 },
    ]);
    expect(pooled.value).toBeCloseTo(10 / 100, 6);
    expect(pooled.basedOn).toBe(1);
  });

  it('écarte aussi les mesures sans dénominateur d’audience', () => {
    const pooled = pooledEngagement([
      { likes: 10, comments: 1, shares: 1, saves: 1, impressions: 200 },
      { likes: 10, comments: 1, shares: 1, saves: 1 },
    ]);
    expect(pooled.basedOn).toBe(1);
    expect(pooled.value).toBeCloseTo(13 / 200, 6);
  });

  it('dit combien de mesures ont servi, et refuse quand aucune n’est complète', () => {
    const none = pooledEngagement([{ likes: 5, impressions: 100 }, { views: 40 }]);
    expect(none.value).toBeNull();
    expect(none.basedOn).toBe(0);
    expect(none.reason).toMatch(/Aucune mesure complète/);
  });

  it('convertit une ligne de mesure en sac de métriques', () => {
    const bag = toBag({ views: 5, likes: null, comments: 2 });
    expect(bag).toEqual({ views: 5, comments: 2 });
  });
});

describe('sélection de la mesure retenue', () => {
  const at = (iso: string): Date => new Date(iso);

  it('garde la mesure la plus récente par cible', () => {
    const rows = [
      {
        targetId: 'a',
        collectedAt: at('2026-01-01T00:00:00Z'),
        syncedAt: at('2026-01-01T00:00:00Z'),
        views: 10,
      },
      {
        targetId: 'a',
        collectedAt: at('2026-02-01T00:00:00Z'),
        syncedAt: at('2026-02-01T00:00:00Z'),
        views: 50,
      },
      {
        targetId: 'b',
        collectedAt: at('2026-01-15T00:00:00Z'),
        syncedAt: at('2026-01-15T00:00:00Z'),
        views: 7,
      },
    ];
    const latest = latestByTarget(rows);
    expect(latest).toHaveLength(2);
    expect(latest.find((row) => row.targetId === 'a')?.views).toBe(50);
  });

  it('départage deux mesures à la même date par la date d’enregistrement', () => {
    const rows = [
      {
        targetId: 'a',
        collectedAt: at('2026-01-01T00:00:00Z'),
        syncedAt: at('2026-01-01T00:00:00Z'),
        views: 1,
      },
      {
        targetId: 'a',
        collectedAt: at('2026-01-01T00:00:00Z'),
        syncedAt: at('2026-03-01T00:00:00Z'),
        views: 2,
      },
    ];
    expect(latestByTarget(rows)[0]?.views).toBe(2);
  });

  it('ne déduplique pas des cibles différentes', () => {
    const rows = [
      {
        targetId: 'a',
        collectedAt: at('2026-01-01T00:00:00Z'),
        syncedAt: at('2026-01-01T00:00:00Z'),
      },
      {
        targetId: 'b',
        collectedAt: at('2026-01-01T00:00:00Z'),
        syncedAt: at('2026-01-01T00:00:00Z'),
      },
    ];
    expect(latestByTarget(rows)).toHaveLength(2);
  });
});

describe('période', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  it('couvre les 30 derniers jours par défaut', () => {
    const window = resolveWindow({}, now);
    expect(window.to.toISOString()).toBe(now.toISOString());
    expect(window.from.toISOString()).toBe('2026-05-16T12:00:00.000Z');
  });

  it('respecte la période demandée', () => {
    const window = resolveWindow({ from: '2026-01-01T00:00:00Z', to: '2026-01-31T00:00:00Z' }, now);
    expect(window.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });

  it('refuse une période inversée', () => {
    expect(() =>
      resolveWindow({ from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }, now),
    ).toThrow(BadRequestException);
  });

  it('refuse une période de plus d’un an', () => {
    expect(() =>
      resolveWindow({ from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }, now),
    ).toThrow(/366 jours/);
  });
});

describe('saisie d’une mesure', () => {
  it('exige au moins une métrique', () => {
    expect(recordMetricSchema.safeParse({}).success).toBe(false);
    expect(recordMetricSchema.safeParse({ note: 'relevé' }).success).toBe(false);
    expect(recordMetricSchema.safeParse({ views: 0 }).success).toBe(true);
  });

  it('refuse une valeur négative', () => {
    const result = recordMetricSchema.safeParse({ views: -1 });
    expect(result.success).toBe(false);
  });

  it('accepte null pour dire « non disponible »', () => {
    const result = recordMetricSchema.safeParse({ views: 12, likes: null });
    expect(result.success).toBe(true);
  });

  it('refuse une date de relevé invalide', () => {
    expect(recordMetricSchema.safeParse({ views: 1, collectedAt: 'hier' }).success).toBe(false);
  });

  it('exige la cible dans la requête complète', () => {
    expect(recordMeasurementSchema.safeParse({ views: 1 }).success).toBe(false);
    expect(
      recordMeasurementSchema.safeParse({ publicationId: 'p', targetId: 't', views: 1 }).success,
    ).toBe(true);
  });

  it('borne la note', () => {
    expect(recordMetricSchema.safeParse({ views: 1, note: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('export CSV', () => {
  it('laisse une cellule vide pour une métrique indisponible', () => {
    expect(csvNumber(null)).toBe('');
    expect(csvNumber(undefined)).toBe('');
    expect(csvNumber(0)).toBe('0');
  });

  it('échappe les séparateurs et les guillemets', () => {
    expect(csvCell('simple')).toBe('simple');
    expect(csvCell('avec;point-virgule')).toBe('"avec;point-virgule"');
    expect(csvCell('dit "bonjour"')).toBe('"dit ""bonjour"""');
    expect(csvCell('deux\nlignes')).toBe('"deux\nlignes"');
  });

  it('produit un CSV lisible par Excel en français', () => {
    const csv = toCsv([
      ['Réseau', 'Vues'],
      ['LinkedIn', '1200'],
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Réseau;Vues');
    expect(csv).toContain('LinkedIn;1200');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('couvre tous les champs déclarés', () => {
    expect(metricFields).toHaveLength(8);
    expect(new Set(metricFields).size).toBe(8);
  });
});
