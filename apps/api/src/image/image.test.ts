import { describe, expect, it } from 'vitest';
import {
  checkPlatformFormat,
  createImageProjectSchema,
  imageFormatSpecs,
  MAX_IMAGE_SIDE,
  MIN_IMAGE_SIDE,
  nearestFormat,
  platformImageFormats,
  resolveDimensions,
  updateImageProjectSchema,
} from '@ass/shared';

/**
 * §8 : « le Brand Kit ne doit pas imposer d'éléments incompatibles ».
 * Ces tests verrouillent la correspondance format ↔ plateforme et le
 * rapprochement d'un format personnalisé vers un format normalisé.
 */

describe('resolveDimensions', () => {
  it('renvoie les dimensions canoniques du format', () => {
    expect(resolveDimensions('SQUARE')).toEqual({ width: 1080, height: 1080 });
    expect(resolveDimensions('STORY_9_16')).toEqual({ width: 1080, height: 1920 });
    expect(resolveDimensions('LANDSCAPE_16_9')).toEqual({ width: 1920, height: 1080 });
  });

  it('respecte les dimensions d’un format personnalisé', () => {
    expect(resolveDimensions('CUSTOM', 800, 1200)).toEqual({ width: 800, height: 1200 });
  });

  it('retombe sur du carré si un format personnalisé est incomplet', () => {
    expect(resolveDimensions('CUSTOM')).toEqual({ width: 1080, height: 1080 });
  });
});

describe('nearestFormat', () => {
  it('reconnaît chaque format normalisé', () => {
    for (const [format, spec] of Object.entries(imageFormatSpecs)) {
      expect(nearestFormat(spec.width, spec.height)).toBe(format);
    }
  });

  it('tolère un écart de 4 %', () => {
    // 1:1 à 2 % près reste un carré.
    expect(nearestFormat(1080, 1100)).toBe('SQUARE');
  });

  it('renvoie null au-delà de la tolérance', () => {
    expect(nearestFormat(2000, 1000)).toBeNull();
  });

  it('refuse un rapport absurde', () => {
    expect(nearestFormat(4000, 300)).toBeNull();
  });
});

describe('checkPlatformFormat', () => {
  it('accepte un carré sur Instagram', () => {
    expect(checkPlatformFormat('INSTAGRAM', 'SQUARE', 1080, 1080)).toBeNull();
  });

  it('refuse une story sur LinkedIn', () => {
    const error = checkPlatformFormat('LINKEDIN', 'STORY_9_16', 1080, 1920);
    expect(error).toMatch(/incompatible/i);
    expect(error).toMatch(/Carré/);
  });

  it('refuse un carré sur YouTube', () => {
    expect(checkPlatformFormat('YOUTUBE', 'SQUARE', 1080, 1080)).toMatch(/incompatible/i);
  });

  it('accepte un story sur TikTok', () => {
    expect(checkPlatformFormat('TIKTOK', 'STORY_9_16', 1080, 1920)).toBeNull();
  });

  it('rapproche un format personnalisé compatible', () => {
    expect(checkPlatformFormat('TIKTOK', 'CUSTOM', 1080, 1920)).toBeNull();
  });

  it('refuse un format personnalisé sans équivalent', () => {
    const error = checkPlatformFormat('INSTAGRAM', 'CUSTOM', 2000, 1000);
    expect(error).toMatch(/2000×1000/);
  });

  it('couvre toutes les plateformes du contrat', () => {
    for (const [platform, formats] of Object.entries(platformImageFormats)) {
      expect(formats.length).toBeGreaterThan(0);
      for (const format of formats) {
        const spec = imageFormatSpecs[format as keyof typeof imageFormatSpecs];
        expect(checkPlatformFormat(platform as never, format, spec.width, spec.height)).toBeNull();
      }
    }
  });
});

describe('createImageProjectSchema', () => {
  it('accepte une demande minimale', () => {
    const parsed = createImageProjectSchema.parse({ prompt: 'Une annonce de lancement sobre' });
    expect(parsed.format).toBeUndefined();
    expect(parsed.palette).toBeUndefined();
  });

  it('refuse un prompt trop court', () => {
    expect(() => createImageProjectSchema.parse({ prompt: 'court' })).toThrow(/10 caractères/);
  });

  it('exige largeur et hauteur pour un format personnalisé', () => {
    const result = createImageProjectSchema.safeParse({
      prompt: 'Une annonce de lancement sobre',
      format: 'CUSTOM',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('width');
      expect(paths).toContain('height');
    }
  });

  it('accepte un format personnalisé complet', () => {
    const parsed = createImageProjectSchema.parse({
      prompt: 'Une annonce de lancement sobre',
      format: 'CUSTOM',
      width: 800,
      height: 1200,
    });
    expect(parsed.width).toBe(800);
  });

  it('borne les dimensions', () => {
    expect(() =>
      createImageProjectSchema.parse({
        prompt: 'Une annonce de lancement sobre',
        width: MIN_IMAGE_SIDE - 1,
      }),
    ).toThrow();
    expect(() =>
      createImageProjectSchema.parse({
        prompt: 'Une annonce de lancement sobre',
        width: MAX_IMAGE_SIDE + 1,
      }),
    ).toThrow();
  });

  it('refuse une couleur non hexadécimale', () => {
    expect(() =>
      createImageProjectSchema.parse({
        prompt: 'Une annonce de lancement sobre',
        palette: ['rouge'],
      }),
    ).toThrow(/hexadécimale/i);
  });

  it('refuse plus de huit couleurs', () => {
    expect(() =>
      createImageProjectSchema.parse({
        prompt: 'Une annonce de lancement sobre',
        palette: Array.from({ length: 9 }, () => '#112233'),
      }),
    ).toThrow();
  });
});

describe('updateImageProjectSchema', () => {
  it('refuse une modification vide', () => {
    expect(() => updateImageProjectSchema.parse({})).toThrow(/Aucune modification/);
  });

  it('accepte l’effacement explicite d’un texte', () => {
    const parsed = updateImageProjectSchema.parse({ headline: null });
    expect(parsed.headline).toBeNull();
  });

  it('accepte un changement de graine seul', () => {
    expect(updateImageProjectSchema.parse({ seed: 7 }).seed).toBe(7);
  });
});
