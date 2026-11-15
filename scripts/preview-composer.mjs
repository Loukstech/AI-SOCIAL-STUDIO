#!/usr/bin/env node
/**
 * Planche de contrôle visuel du composeur (usage interne, non déployé).
 *
 *   node scripts/preview-composer.mjs
 *
 * Écrit `tmp/composer-preview.html` : une grille de visuels représentatifs.
 * Sert à juger le rendu réel, pas seulement la validité du SVG.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { composeImage } from '../apps/api/dist/image/composer.js';

const palette = ['#0f172a', '#7c5cff', '#22d3ee'];
const warm = ['#2b1b12', '#f97316', '#fbbf24'];
const light = ['#e8e4dc', '#1f2937', '#7c5cff'];

const cases = [
  {
    label: 'SQUARE · Éditorial',
    input: {
      width: 1080,
      height: 1080,
      format: 'SQUARE',
      style: 'EDITORIAL',
      headline: 'Ouvrir un atelier qui dure',
      subheadline: 'Trois principes pour tenir dans le temps sans brûler les étapes.',
      callToAction: 'Lire le guide',
      badge: 'Guide',
      palette,
      logoHref: null,
      referenceHref: null,
      brandName: 'Atelier Nord',
      slogan: 'Le contenu, sans bruit',
      seed: 424242,
    },
  },
  {
    label: 'STORY · Affirmé',
    input: {
      width: 1080,
      height: 1920,
      format: 'STORY_9_16',
      style: 'BOLD',
      headline: 'Portes ouvertes samedi',
      subheadline: 'De 10 h à 18 h, sans inscription.',
      callToAction: 'Réserver',
      badge: 'Atelier',
      palette: warm,
      logoHref: null,
      referenceHref: null,
      brandName: 'Atelier Nord',
      slogan: null,
      seed: 7,
    },
  },
  {
    label: 'PORTRAIT 4:5 · Minimal',
    input: {
      width: 1080,
      height: 1350,
      format: 'PORTRAIT_4_5',
      style: 'MINIMAL',
      headline: 'Un titre sobre, une seule idée',
      subheadline: 'Le minimalisme n’est pas l’absence de style.',
      callToAction: null,
      badge: null,
      palette: light,
      logoHref: null,
      referenceHref: null,
      brandName: 'Atelier Nord',
      slogan: 'Le contenu, sans bruit',
      seed: 91,
    },
  },
  {
    label: 'LANDSCAPE 16:9 · Dégradé',
    input: {
      width: 1920,
      height: 1080,
      format: 'LANDSCAPE_16_9',
      style: 'GRADIENT',
      headline: 'Le calendrier éditorial, sans tableur',
      subheadline: 'Planifier, valider, publier — au même endroit.',
      callToAction: 'Découvrir',
      badge: 'Nouveau',
      palette: ['#111827', '#2563eb', '#38bdf8'],
      logoHref: null,
      referenceHref: null,
      brandName: 'Atelier Nord',
      slogan: null,
      seed: 2024,
    },
  },
  {
    label: 'SQUARE · Titre très long',
    input: {
      width: 1080,
      height: 1080,
      format: 'SQUARE',
      style: 'EDITORIAL',
      headline:
        'Un titre volontairement interminable pour vérifier que la troncature reste lisible et signalée',
      subheadline: 'Le débordement doit être visible dans les avertissements.',
      callToAction: null,
      badge: null,
      palette,
      logoHref: null,
      referenceHref: null,
      brandName: null,
      slogan: null,
      seed: 5,
    },
  },
  {
    label: 'SQUARE · Contraste limite',
    input: {
      width: 1080,
      height: 1080,
      format: 'SQUARE',
      style: 'EDITORIAL',
      headline: 'Fond gris moyen',
      subheadline: 'Le contraste doit déclencher un avertissement.',
      callToAction: null,
      badge: null,
      palette: ['#a0a0a0', '#7c5cff', '#22d3ee'],
      logoHref: null,
      referenceHref: null,
      brandName: 'Atelier Nord',
      slogan: null,
      seed: 33,
    },
  },
];

const cards = cases
  .map(({ label, input }) => {
    const { svg, warnings } = composeImage(input);
    const warningsMarkup = warnings.length
      ? `<ul>${warnings.map((warning) => `<li>${warning}</li>`).join('')}</ul>`
      : '<p class="clean">Aucun avertissement</p>';
    return `<figure>
      <div class="frame" style="aspect-ratio:${input.width}/${input.height}">${svg}</div>
      <figcaption><strong>${label}</strong>${warningsMarkup}</figcaption>
    </figure>`;
  })
  .join('\n');

const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>Planche de contrôle — composeur</title>
<style>
  body { margin: 0; padding: 24px; background: #0b0d12; color: #e6e8ee;
         font-family: Inter, "Segoe UI", system-ui, sans-serif; }
  h1 { font-size: 18px; margin: 0 0 20px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  figure { margin: 0; }
  .frame { width: 100%; border-radius: 10px; overflow: hidden; border: 1px solid #2a2f3a; }
  .frame svg { display: block; width: 100%; height: 100%; }
  figcaption { margin-top: 8px; font-size: 12px; line-height: 1.5; color: #9aa3b2; }
  figcaption strong { color: #e6e8ee; display: block; margin-bottom: 4px; }
  ul { margin: 0; padding-left: 16px; }
  .clean { margin: 0; color: #4ade80; }
</style></head>
<body><h1>Composeur — planche de contrôle</h1><div class="grid">${cards}</div></body></html>`;

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/composer-preview.html', html, 'utf8');
console.log('tmp/composer-preview.html');
