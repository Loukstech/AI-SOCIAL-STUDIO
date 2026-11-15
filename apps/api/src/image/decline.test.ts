import { describe, expect, it } from 'vitest';
import { declineImageProjectSchema, planDecline } from '@ass/shared';

/**
 * La déclinaison est la règle métier du §7 : produire la même idée dans
 * plusieurs gabarits. Ce qui compte ici, c'est qu'aucun format ne soit produit
 * silencieusement de travers — soit il est accepté, soit il est refusé avec une
 * raison lisible.
 */

const base = { sourceFormat: 'SQUARE' as const, platform: null };

describe('planDecline', () => {
  it('accepte un format différent', () => {
    const plan = planDecline({ ...base, formats: ['STORY_9_16'] });
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]?.format).toBe('STORY_9_16');
    expect(plan.skipped).toEqual([]);
  });

  it('ignore le format d’origine', () => {
    const plan = planDecline({ ...base, formats: ['SQUARE'] });
    expect(plan.targets).toEqual([]);
    expect(plan.skipped[0]?.format).toBe('SQUARE');
    expect(plan.skipped[0]?.reason).toMatch(/identique/i);
  });

  it('ignore un format personnalisé', () => {
    const plan = planDecline({ ...base, formats: ['CUSTOM'] });
    expect(plan.targets).toEqual([]);
    expect(plan.skipped[0]?.reason).toMatch(/dimensions/i);
  });

  it('déduplique les demandes', () => {
    const plan = planDecline({ ...base, formats: ['STORY_9_16', 'STORY_9_16'] });
    expect(plan.targets).toHaveLength(1);
  });

  it('conserve l’ordre demandé', () => {
    const plan = planDecline({
      ...base,
      formats: ['LANDSCAPE_16_9', 'PORTRAIT_4_5', 'STORY_9_16'],
    });
    expect(plan.targets.map((target) => target.format)).toEqual([
      'LANDSCAPE_16_9',
      'PORTRAIT_4_5',
      'STORY_9_16',
    ]);
  });

  it('sans plateforme, aucun avertissement', () => {
    const plan = planDecline({ ...base, formats: ['STORY_9_16'] });
    expect(plan.targets[0]?.platform).toBeNull();
    expect(plan.targets[0]?.warning).toBeNull();
  });

  it('reprend la plateforme quand le format est compatible', () => {
    const plan = planDecline({
      sourceFormat: 'SQUARE',
      platform: 'INSTAGRAM',
      formats: ['STORY_9_16'],
    });
    expect(plan.targets[0]?.platform).toBe('INSTAGRAM');
    expect(plan.targets[0]?.warning).toBeNull();
  });

  it('retire la plateforme incompatible et explique pourquoi', () => {
    const plan = planDecline({
      sourceFormat: 'SQUARE',
      platform: 'LINKEDIN',
      formats: ['STORY_9_16'],
    });
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]?.platform).toBeNull();
    expect(plan.targets[0]?.warning).toMatch(/sans plateforme/i);
    expect(plan.targets[0]?.warning).toMatch(/incompatible/i);
  });

  it('garde la plateforme sur un format paysage compatible avec LinkedIn', () => {
    const plan = planDecline({
      sourceFormat: 'SQUARE',
      platform: 'LINKEDIN',
      formats: ['LANDSCAPE_16_9'],
    });
    expect(plan.targets[0]?.platform).toBe('LINKEDIN');
    expect(plan.targets[0]?.warning).toBeNull();
  });

  it('produit des formats dont les dimensions diffèrent de la source', () => {
    const plan = planDecline({ ...base, formats: ['STORY_9_16', 'LANDSCAPE_16_9'] });
    expect(plan.targets.map((target) => target.format)).not.toContain('SQUARE');
  });

  it('renvoie un plan vide pour une demande vide', () => {
    const plan = planDecline({ ...base, formats: [] });
    expect(plan.targets).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it('accepte une déclinaison depuis un format non carré', () => {
    const plan = planDecline({
      sourceFormat: 'STORY_9_16',
      platform: 'TIKTOK',
      formats: ['SQUARE'],
    });
    expect(plan.targets[0]?.format).toBe('SQUARE');
    expect(plan.targets[0]?.platform).toBeNull();
    expect(plan.targets[0]?.warning).toMatch(/sans plateforme/i);
  });
});

describe('declineImageProjectSchema', () => {
  it('exige au moins un format', () => {
    expect(() => declineImageProjectSchema.parse({ formats: [] })).toThrow();
  });

  it('borne la demande à cinq formats', () => {
    const formats = ['SQUARE', 'PORTRAIT_4_5', 'STORY_9_16', 'LANDSCAPE_16_9', 'CUSTOM'];
    expect(() => declineImageProjectSchema.parse({ formats })).not.toThrow();
    expect(() => declineImageProjectSchema.parse({ formats: [...formats, 'SQUARE'] })).toThrow();
  });

  it('refuse un format inconnu', () => {
    expect(() => declineImageProjectSchema.parse({ formats: ['CARRE'] })).toThrow();
  });
});
