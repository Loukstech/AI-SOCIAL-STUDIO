import { describe, expect, it } from 'vitest';
import type { ComposeInput } from './composer.js';
import {
  composeImage,
  escapeXml,
  fitBlock,
  mix,
  readableOn,
  relativeLuminance,
  wrapText,
} from './composer.js';

/**
 * Le composeur est le cœur du §7 : s'il casse le SVG ou perd du texte, le
 * visuel est inutilisable. Ces tests verrouillent les propriétés dont dépend
 * la promesse « image reproductible, textes corrigeables ».
 */

const base: ComposeInput = {
  width: 1080,
  height: 1080,
  format: 'SQUARE',
  style: 'EDITORIAL',
  headline: 'Lancer une marque qui dure',
  subheadline: 'Trois principes éditoriaux pour tenir dans le temps.',
  callToAction: 'Découvrir',
  badge: 'Guide',
  palette: ['#0f172a', '#7c5cff', '#22d3ee'],
  logoHref: 'https://cdn.example.com/logo.svg',
  referenceHref: null,
  brandName: 'Atelier Nord',
  slogan: 'Le contenu, sans bruit',
  seed: 424242,
};

function compose(overrides: Partial<ComposeInput> = {}) {
  return composeImage({ ...base, ...overrides });
}

/**
 * Le composeur découpe chaque bloc en un `<text>` par ligne : on recompose le
 * flux textuel pour vérifier qu'aucun mot n'a été perdu au passage.
 */
function textContent(svg: string): string {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map((match) => match[1] ?? '')
    .join(' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('escapeXml', () => {
  it('échappe les cinq caractères réservés', () => {
    expect(escapeXml(`<a href="x">l'été & co</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;l&apos;été &amp; co&lt;/a&gt;',
    );
  });

  it('laisse intact un texte sans caractère réservé', () => {
    expect(escapeXml('Atelier Nord')).toBe('Atelier Nord');
  });

  it('échappe les esperluettes déjà encodées, sans double décodage', () => {
    expect(escapeXml('&amp;')).toBe('&amp;amp;');
  });
});

describe('couleurs', () => {
  it('mix renvoie la borne exacte aux extrémités', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('mix renvoie le point médian au milieu', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('relativeLuminance couvre les extrêmes', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6);
  });

  it('readableOn choisit un texte sombre sur fond clair', () => {
    expect(readableOn('#ffffff')).toBe('#0b0d12');
  });

  it('readableOn choisit un texte clair sur fond sombre', () => {
    expect(readableOn('#0f172a')).toBe('#ffffff');
  });
});

describe('wrapText', () => {
  it('coupe aux espaces', () => {
    expect(wrapText('un deux trois quatre', 10)).toEqual(['un deux', 'trois', 'quatre']);
  });

  it('découpe durement un mot plus long que la ligne', () => {
    expect(wrapText('abcdefghijklmno', 5)).toEqual(['abcde', 'fghij', 'klmno']);
  });

  it('renvoie une ligne vide pour un texte vide', () => {
    expect(wrapText('   ', 10)).toEqual(['']);
  });

  it('impose une largeur minimale de 4 caractères', () => {
    expect(wrapText('ab cd', 1)).toEqual(['ab', 'cd']);
  });

  it('ne perd aucun mot', () => {
    const text = 'Le contenu sans bruit reste le meilleur argument';
    const joined = wrapText(text, 12).join(' ');
    expect(joined.split(/\s+/u).filter(Boolean)).toEqual(text.split(' '));
  });
});

describe('fitBlock', () => {
  it('garde la taille maximale quand le texte tient', () => {
    const block = fitBlock('Bonjour', {
      maxWidth: 600,
      maxHeight: 400,
      maxLines: 3,
      maxFontSize: 60,
      minFontSize: 20,
    });
    expect(block.truncated).toBe(false);
    expect(block.fontSize).toBe(60);
    expect(block.lines).toEqual(['Bonjour']);
  });

  it('réduit la police avant de tronquer', () => {
    const block = fitBlock('Un titre un peu long mais raisonnable', {
      maxWidth: 300,
      maxHeight: 120,
      maxLines: 3,
      maxFontSize: 80,
      minFontSize: 16,
    });
    expect(block.truncated).toBe(false);
    expect(block.fontSize).toBeLessThan(80);
    expect(block.fontSize).toBeGreaterThanOrEqual(16);
  });

  it('tronque et signale quand même la taille minimale déborde', () => {
    const block = fitBlock('a'.repeat(200), {
      maxWidth: 100,
      maxHeight: 40,
      maxLines: 2,
      maxFontSize: 40,
      minFontSize: 20,
    });
    expect(block.truncated).toBe(true);
    expect(block.lines).toHaveLength(2);
    expect(block.lines[1]?.endsWith('…')).toBe(true);
    expect(block.fontSize).toBe(20);
  });

  it('respecte toujours maxLines', () => {
    const block = fitBlock('mot '.repeat(80), {
      maxWidth: 200,
      maxHeight: 60,
      maxLines: 2,
      maxFontSize: 40,
      minFontSize: 12,
    });
    expect(block.lines.length).toBeLessThanOrEqual(2);
  });
});

describe('composeImage', () => {
  it('produit un document SVG bien formé', () => {
    const { svg } = compose();
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox="0 0 1080 1080"');
    expect((svg.match(/<svg/g) ?? []).length).toBe(1);
    expect((svg.match(/<\/svg>/g) ?? []).length).toBe(1);
  });

  it('est déterministe pour une même graine', () => {
    expect(compose().svg).toBe(compose().svg);
  });

  it('change le décor quand la graine change', () => {
    expect(compose({ seed: 1 }).svg).not.toBe(compose({ seed: 2 }).svg);
  });

  it('conserve le texte comme calques éditables', () => {
    const { svg } = compose();
    const text = textContent(svg);
    // Chaque bloc reste un <text> : rien n'est rasterisé, tout est corrigeable.
    expect(text).toContain('Lancer une marque qui dure');
    expect(text).toContain('Trois principes éditoriaux pour tenir dans le temps.');
    expect(text).toContain('Découvrir');
    expect(text).toContain('Guide');
    expect(text).toContain('Atelier Nord');
    expect(text).toContain('Le contenu, sans bruit');
    expect(svg).not.toContain('<image href="data:');
  });

  it('échappe le texte saisi par l’utilisateur', () => {
    const { svg } = compose({ headline: '<script>alert("x")</script>' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&quot;');
  });

  it('référence le logo sans le copier', () => {
    const { svg } = compose();
    expect(svg).toContain('<image href="https://cdn.example.com/logo.svg"');
  });

  it('signale l’absence de logo', () => {
    const { warnings } = compose({ logoHref: null });
    expect(warnings.join(' ')).toMatch(/aucun logo/i);
  });

  it('avertit quand le contraste fond/texte est limite', () => {
    const { warnings } = compose({ palette: ['#a0a0a0', '#7c5cff', '#22d3ee'] });
    expect(warnings.join(' ')).toMatch(/contraste/i);
  });

  it('n’avertit pas sur un fond très sombre', () => {
    const { warnings } = compose();
    expect(warnings.join(' ')).not.toMatch(/contraste/i);
  });

  it('signale la troncature du titre', () => {
    const { warnings } = compose({ headline: 'Titre démesurément long '.repeat(12) });
    expect(warnings.join(' ')).toMatch(/titre.*tronqu/i);
  });

  it('rend l’image de référence en fond voilé', () => {
    const { svg } = compose({ referenceHref: 'https://cdn.example.com/photo.jpg' });
    expect(svg).toContain('<image href="https://cdn.example.com/photo.jpg"');
    expect(svg).toContain('opacity="0.62"');
  });

  it('met le titre en majuscules sur le style BOLD', () => {
    const { svg } = compose({ style: 'BOLD', headline: 'Annonce importante' });
    expect(textContent(svg)).toContain('ANNONCE IMPORTANTE');
  });

  it('ne produit jamais NaN ni undefined', () => {
    for (const style of ['EDITORIAL', 'BOLD', 'MINIMAL', 'GRADIENT'] as const) {
      for (const format of ['SQUARE', 'PORTRAIT_4_5', 'STORY_9_16', 'LANDSCAPE_16_9'] as const) {
        const size =
          format === 'SQUARE'
            ? { width: 1080, height: 1080 }
            : format === 'PORTRAIT_4_5'
              ? { width: 1080, height: 1350 }
              : format === 'STORY_9_16'
                ? { width: 1080, height: 1920 }
                : { width: 1920, height: 1080 };
        const { svg } = compose({ style, format, ...size });
        expect(svg).not.toMatch(/NaN|undefined/);
      }
    }
  });

  it('fonctionne sans aucun texte fourni', () => {
    const { svg } = compose({
      headline: null,
      subheadline: null,
      callToAction: null,
      badge: null,
      brandName: null,
      slogan: null,
      logoHref: null,
    });
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('aria-label="Visuel généré"');
  });

  it('utilise la palette fournie', () => {
    const { svg } = compose({ palette: ['#101010', '#e0245e', '#1da1f2'] });
    expect(svg).toContain('#101010');
  });

  it('complète une palette trop courte sans casser', () => {
    const { svg } = compose({ palette: ['#123456'] });
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).not.toMatch(/NaN|undefined/);
  });
});
