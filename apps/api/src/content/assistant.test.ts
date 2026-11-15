import { describe, expect, it } from 'vitest';
import { platformSpecs, rewriteActions } from '@ass/shared';
import {
  addCallToAction,
  applyAction,
  fixText,
  proposeHashtags,
  shorten,
  variations,
  type AssistantInput,
} from './assistant.js';

const input: AssistantInput = {
  body: 'bonne nouvelle !  notre  formation  est disponible .\n\nElle  dure  quatre  semaines.',
  hashtags: ['#Formation'],
  callToAction: null,
  platform: 'LINKEDIN',
  language: 'FR',
  tone: 'PROFESSIONAL',
  subject: 'nouvelle formation en intelligence artificielle',
};

describe('assistant rédactionnel (§6.4)', () => {
  it('expose les neuf actions du cahier des charges', () => {
    expect(rewriteActions).toHaveLength(9);
  });

  it('corrige les espaces et les majuscules', () => {
    const fixed = fixText(input.body);
    expect(fixed).not.toMatch(/ {2}/);
    expect(fixed.startsWith('Bonne nouvelle')).toBe(true);
    expect(fixed).not.toMatch(/\s\./);
  });

  it('raccourcit sans dépasser la cible', () => {
    const long = `${'Première phrase assez longue pour occuper de la place. '.repeat(4)}Conclusion finale.`;
    const short = shorten(long, 120);
    expect(short.length).toBeLessThanOrEqual(120);
    expect(short.length).toBeGreaterThan(0);
  });

  it('développe en ajoutant du contexte', () => {
    const expanded = applyAction('EXPAND', input);
    expect(expanded.body.length).toBeGreaterThan(input.body.length);
    expect(expanded.body).toContain(input.subject);
  });

  it('ajoute un appel à l’action quand il en manque un', () => {
    const result = applyAction('ADD_CTA', input);
    expect(result.callToAction).toBeTruthy();
    expect(result.body).toContain(result.callToAction!);
  });

  it('ne duplique pas un appel à l’action déjà présent', () => {
    const once = addCallToAction(
      'Texte existant.',
      'Dites-nous ce que vous en pensez.',
      'LINKEDIN',
      'FR',
    );
    const twice = addCallToAction(once.body, once.callToAction, 'LINKEDIN', 'FR');
    expect(twice.body).toBe(once.body);
  });

  it('propose des hashtags dans la limite de la plateforme', () => {
    const tags = proposeHashtags(input.body, input.subject, 'FR', 'X');
    expect(tags.length).toBeLessThanOrEqual(platformSpecs.X.maxHashtags);
    expect(tags.every((tag) => tag.startsWith('#'))).toBe(true);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('change le ton du texte', () => {
    const professional = applyAction('CHANGE_TONE', { ...input, tone: 'PROFESSIONAL' });
    const playful = applyAction('CHANGE_TONE', { ...input, tone: 'PLAYFUL' });
    expect(professional.body).not.toBe(playful.body);
  });

  it('reformule sans perdre le texte', () => {
    const rephrased = applyAction('REPHRASE', input);
    expect(rephrased.body.length).toBeGreaterThan(0);
    expect(rephrased.note).toMatch(/reformul|retravaill/i);
  });

  it('propose plusieurs ouvertures', () => {
    const options = variations('Première phrase. Deuxième phrase.', 'FR', 'DYNAMIC');
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(new Set(options).size).toBe(options.length);
  });

  it('renvoie une note explicative pour chaque action réécrite', () => {
    for (const action of [
      'FIX',
      'REPHRASE',
      'SHORTEN',
      'EXPAND',
      'CHANGE_TONE',
      'ADD_CTA',
      'HASHTAGS',
      'VARIATIONS',
    ] as const) {
      const result = applyAction(action, input);
      expect(result.note.length).toBeGreaterThan(0);
      expect(result.body.length).toBeGreaterThan(0);
    }
  });
});
