import { describe, expect, it } from 'vitest';
import { platformSpecs, socialPlatforms } from '@ass/shared';
import {
  analyseBrief,
  buildHashtags,
  clampToLimit,
  generateVariant,
  generateVariants,
  type Brief,
} from './content-generator.js';

const SPEC_BRIEF =
  'Crée une publication professionnelle pour annoncer notre nouvelle formation en intelligence artificielle. Le ton doit être dynamique et accessible. Encourage les personnes intéressées à s’inscrire.';

const brief: Brief = {
  brief: SPEC_BRIEF,
  subject: 'nouvelle formation en intelligence artificielle',
  objective: 'annoncer',
  audience: null,
  tone: 'DYNAMIC',
  contentType: 'ANNOUNCEMENT',
  language: 'FR',
  brandName: null,
};

describe('analyse du brief (§6.1)', () => {
  it('extrait le sujet et l’objectif de l’exemple du cahier des charges', () => {
    const analysis = analyseBrief(SPEC_BRIEF);
    expect(analysis.subject).toBe('nouvelle formation en intelligence artificielle');
    expect(analysis.objective).toBe('annoncer');
  });

  it('déduit l’objectif d’un verbe d’action initial', () => {
    const analysis = analyseBrief('Annonce le lancement de notre application mobile.');
    expect(analysis.objective).toBe('annoncer');
    expect(analysis.subject.toLowerCase()).toContain('lancement');
  });

  it('détecte un public explicite', () => {
    const analysis = analyseBrief('Présente notre outil aux débutants, avec un ton simple.');
    expect(analysis.audience).toBe('débutants');
  });

  it('ne confond pas une consigne avec le sujet', () => {
    const analysis = analyseBrief(
      'Rédige une promotion pour notre offre d’été. Le ton doit être chaleureux. Ajoute un appel à l’action.',
    );
    expect(analysis.subject).not.toMatch(/ton|appel à l/i);
    expect(analysis.subject).toContain('offre d’été');
  });

  it('reste robuste sur un brief minimal', () => {
    const analysis = analyseBrief('Parle de notre marque.');
    expect(analysis.subject.length).toBeGreaterThan(0);
  });
});

describe('génération par plateforme (§6.3)', () => {
  it('produit une variante par plateforme sélectionnée', () => {
    const variants = generateVariants(brief, ['FACEBOOK', 'INSTAGRAM', 'LINKEDIN']);
    expect(variants).toHaveLength(3);
    expect(variants.map((variant) => variant.platform)).toEqual([
      'FACEBOOK',
      'INSTAGRAM',
      'LINKEDIN',
    ]);
  });

  it('respecte la limite de caractères de chaque plateforme', () => {
    for (const platform of socialPlatforms) {
      const variant = generateVariant(brief, platform);
      expect(variant.charCount).toBeLessThanOrEqual(platformSpecs[platform].maxChars);
      expect(variant.charCount).toBeGreaterThan(0);
    }
  });

  it('respecte le nombre maximal de hashtags', () => {
    for (const platform of socialPlatforms) {
      const variant = generateVariant(brief, platform);
      expect(variant.hashtags.length).toBeLessThanOrEqual(platformSpecs[platform].maxHashtags);
    }
  });

  it('fournit un titre aux plateformes qui en attendent un', () => {
    const youtube = generateVariant(brief, 'YOUTUBE');
    const pinterest = generateVariant(brief, 'PINTEREST');
    expect(youtube.title).toBeTruthy();
    expect(pinterest.title).toBeTruthy();
    expect(youtube.title!.length).toBeLessThanOrEqual(platformSpecs.YOUTUBE.titleMaxChars!);

    const x = generateVariant(brief, 'X');
    expect(x.title).toBeNull();
  });

  it('calibre la longueur selon la plateforme', () => {
    const x = generateVariant(brief, 'X');
    const linkedin = generateVariant(brief, 'LINKEDIN');
    expect(x.charCount).toBeLessThanOrEqual(280);
    expect(linkedin.charCount).toBeGreaterThan(x.charCount);
  });

  it('tient compte du ton et du type de contenu', () => {
    const dynamic = generateVariant({ ...brief, tone: 'DYNAMIC' }, 'LINKEDIN');
    const expert = generateVariant({ ...brief, tone: 'EXPERT' }, 'LINKEDIN');
    expect(dynamic.body).not.toBe(expert.body);
  });

  it('reste déterministe pour une même entrée', () => {
    expect(generateVariant(brief, 'INSTAGRAM')).toEqual(generateVariant(brief, 'INSTAGRAM'));
  });

  it('ajoute le nom de marque quand il est fourni', () => {
    const branded = generateVariant({ ...brief, brandName: 'Nova Studio' }, 'FACEBOOK');
    expect(branded.body).toContain('Nova Studio');
  });

  it('signale un dépassement de la longueur recommandée', () => {
    const longSubject =
      'notre nouvelle formation certifiante en intelligence artificielle générative pour les équipes marketing';
    const variant = generateVariant({ ...brief, subject: longSubject }, 'TIKTOK');
    expect(variant.charCount).toBeLessThanOrEqual(platformSpecs.TIKTOK.maxChars);
    expect(variant.warnings.length).toBeGreaterThan(0);
  });

  it('produit un texte en anglais quand la langue est EN', () => {
    const english = generateVariant({ ...brief, language: 'EN' }, 'LINKEDIN');
    expect(english.callToAction).toBe('How do you approach this?');
    expect(english.body).toContain('How do you approach this?');
    expect(english.body).not.toContain('On ne ralentit pas');
    // Limite assumée : le sujet saisi reste dans sa langue d'origine.
    expect(english.body).toContain(brief.subject);
  });

  it('expose un appel à l’action', () => {
    const variant = generateVariant(brief, 'INSTAGRAM');
    expect(variant.callToAction).toBeTruthy();
    expect(variant.body).toContain(variant.callToAction!);
  });
});

describe('utilitaires', () => {
  it('déduplique et borne les hashtags', () => {
    const tags = buildHashtags('formation formation intelligence intelligence', 'FR', 3);
    expect(tags).toHaveLength(3);
    expect(new Set(tags).size).toBe(3);
    expect(tags.every((tag) => tag.startsWith('#'))).toBe(true);
  });

  it('tronque proprement à la limite', () => {
    const text = 'Un texte assez long pour être coupé proprement au bon endroit.';
    const cut = clampToLimit(text, 20);
    expect(cut.length).toBeLessThanOrEqual(20);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('laisse intact un texte déjà dans la limite', () => {
    expect(clampToLimit('Court', 20)).toBe('Court');
  });
});
