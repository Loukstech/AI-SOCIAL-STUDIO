import { describe, expect, it } from 'vitest';
import { composePublicationText } from '@ass/shared';
import { checkPublication, checkTarget } from './capabilities.js';

/**
 * Les limites viennent des capacités réelles des plateformes (§9.4).
 * Ces tests vérifient qu'aucune règle n'est permissive par accident.
 */

describe('composePublicationText', () => {
  it('colle les hashtags au corps avec une ligne vide', () => {
    expect(composePublicationText('Bonjour', ['#a', '#b'])).toBe('Bonjour\n\n#a #b');
  });

  it('renvoie le corps seul sans hashtag', () => {
    expect(composePublicationText('Bonjour', [])).toBe('Bonjour');
  });

  it('ignore les hashtags vides', () => {
    expect(composePublicationText('Bonjour', ['  ', '#a'])).toBe('Bonjour\n\n#a');
  });
});

describe('checkTarget', () => {
  it('accepte un texte simple sur LinkedIn', () => {
    const check = checkTarget({
      platform: 'LINKEDIN',
      postType: 'TEXT',
      body: 'Une annonce courte et professionnelle.',
    });
    expect(check.errors).toEqual([]);
    expect(check.charLimit).toBe(3_000);
  });

  it('refuse un texte trop long pour X', () => {
    const check = checkTarget({ platform: 'X', postType: 'TEXT', body: 'a'.repeat(300) });
    expect(check.errors.join(' ')).toMatch(/trop long/i);
    expect(check.charCount).toBe(300);
  });

  it('compte les hashtags dans la limite', () => {
    const body = 'a'.repeat(270);
    const check = checkTarget({
      platform: 'X',
      postType: 'TEXT',
      body,
      hashtags: ['#aaaaaa', '#bbbbbb'],
    });
    // 270 + 2 sauts de ligne + 15 caractères de hashtags = 287 > 280
    expect(check.charCount).toBeGreaterThan(280);
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('avertit quand la longueur conseillée est dépassée sans bloquer', () => {
    const check = checkTarget({
      platform: 'LINKEDIN',
      postType: 'TEXT',
      body: 'a'.repeat(1_000),
    });
    expect(check.errors).toEqual([]);
    expect(check.warnings.join(' ')).toMatch(/engagement/i);
  });

  it('refuse un format non supporté par la plateforme', () => {
    const check = checkTarget({
      platform: 'TIKTOK',
      postType: 'TEXT',
      body: 'Un texte seul ne part pas sur TikTok.',
      mediaCount: 1,
    });
    expect(check.errors.join(' ')).toMatch(/n’accepte pas le format TEXT/i);
  });

  it('exige un média pour Instagram', () => {
    const check = checkTarget({
      platform: 'INSTAGRAM',
      postType: 'IMAGE',
      body: 'Une légende sans visuel.',
    });
    expect(check.errors.join(' ')).toMatch(/exige au moins un média/i);
  });

  it('accepte Instagram dès qu’un média est fourni', () => {
    const check = checkTarget({
      platform: 'INSTAGRAM',
      postType: 'IMAGE',
      body: 'Une légende avec visuel.',
      mediaCount: 1,
    });
    expect(check.errors).toEqual([]);
  });

  it('refuse trop de médias pour X', () => {
    const check = checkTarget({
      platform: 'X',
      postType: 'IMAGE',
      body: 'Quatre images maximum.',
      mediaCount: 5,
    });
    expect(check.errors.join(' ')).toMatch(/5 médias pour 4/i);
  });

  it('refuse un titre trop long pour YouTube', () => {
    const check = checkTarget({
      platform: 'YOUTUBE',
      postType: 'VIDEO',
      body: 'Description.',
      title: 't'.repeat(120),
      mediaCount: 1,
    });
    expect(check.errors.join(' ')).toMatch(/Titre trop long/i);
  });

  it('avertit qu’un titre est ignoré là où la plateforme n’en affiche pas', () => {
    const check = checkTarget({
      platform: 'X',
      postType: 'TEXT',
      body: 'Un message.',
      title: 'Titre inutile',
    });
    expect(check.warnings.join(' ')).toMatch(/n’affiche pas de titre/i);
  });

  it('refuse un format lien sans URL', () => {
    const check = checkTarget({
      platform: 'FACEBOOK',
      postType: 'LINK',
      body: 'Découvrez notre nouvelle offre.',
    });
    expect(check.errors.join(' ')).toMatch(/sans URL/i);
  });

  it('accepte un format lien avec URL', () => {
    const check = checkTarget({
      platform: 'FACEBOOK',
      postType: 'LINK',
      body: 'Découvrez notre offre : https://exemple.fr',
    });
    expect(check.errors).toEqual([]);
  });

  it('avertit au-delà du nombre de hashtags conseillé', () => {
    const check = checkTarget({
      platform: 'X',
      postType: 'TEXT',
      body: 'Court.',
      hashtags: ['#a', '#b', '#c'],
    });
    expect(check.warnings.join(' ')).toMatch(/3 hashtags pour 2 conseillés/i);
  });
});

describe('checkPublication', () => {
  it('agrège les erreurs en préfixant par la plateforme', () => {
    const result = checkPublication('TEXT', [
      { platform: 'LINKEDIN', body: 'Texte correct.' },
      { platform: 'INSTAGRAM', body: 'Texte sans média.' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((message) => message.startsWith('Instagram'))).toBe(true);
    expect(result.errors.some((message) => message.startsWith('LinkedIn'))).toBe(false);
  });

  it('valide une combinaison entièrement correcte', () => {
    const result = checkPublication('TEXT', [
      { platform: 'LINKEDIN', body: 'Annonce LinkedIn.' },
      { platform: 'FACEBOOK', body: 'Annonce Facebook.' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
