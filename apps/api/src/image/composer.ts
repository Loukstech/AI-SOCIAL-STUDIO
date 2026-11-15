import type { ImageFormat, ImageStyle } from '@ass/shared';

/**
 * Composeur de visuels (§7).
 *
 * Moteur **déterministe** : même entrée + même graine = même image. Il produit
 * un SVG autonome, donc une vraie image vectorielle, dont les textes restent
 * des calques séparés — c'est exactement ce que le cahier des charges exige
 * (« les textes générés doivent pouvoir être corrigés ou remplacés
 * manuellement »). Aucun appel réseau, aucune clé, aucun coût.
 *
 * Un modèle de génération raster se branchera derrière la même interface sans
 * changer les contrats d'API.
 */

export interface ComposeInput {
  width: number;
  height: number;
  format: ImageFormat;
  style: ImageStyle;
  headline: string | null;
  subheadline: string | null;
  callToAction: string | null;
  badge: string | null;
  palette: string[];
  /** URL du logo original. Il est référencé, jamais copié ni altéré. */
  logoHref: string | null;
  /** Première image de référence, utilisée comme fond voilé. */
  referenceHref: string | null;
  brandName: string | null;
  slogan: string | null;
  seed: number;
}

export interface ComposeResult {
  svg: string;
  warnings: string[];
}

const FONT_STACK = "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif";
const DEFAULT_PALETTE = ['#0f172a', '#7c5cff', '#22d3ee'];

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Échappement XML : sans lui, un texte contenant `<` casse le document. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Mélange deux couleurs : `t = 0` renvoie `a`, `t = 1` renvoie `b`. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Couleur de texte lisible sur un fond donné. */
export function readableOn(background: string): string {
  return relativeLuminance(background) > 0.42 ? '#0b0d12' : '#ffffff';
}

/** Coupe un texte en lignes d'au plus `maxChars`, sans casser les mots si possible. */
export function wrapText(text: string, maxChars: number): string[] {
  const limit = Math.max(4, maxChars);
  const words = text.split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (word.length <= limit) {
      current = word;
      continue;
    }
    // Mot plus long que la ligne : découpe dure pour ne pas déborder.
    let rest = word;
    while (rest.length > limit) {
      lines.push(rest.slice(0, limit));
      rest = rest.slice(limit);
    }
    current = rest;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

interface Block {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  truncated: boolean;
}

/**
 * Ajuste la taille de police pour tenir dans l'espace disponible, puis tronque
 * proprement si même la taille minimale déborde. Le débordement est signalé.
 */
export function fitBlock(
  text: string,
  options: {
    maxWidth: number;
    maxHeight: number;
    maxLines: number;
    maxFontSize: number;
    minFontSize: number;
    lineHeightFactor?: number;
  },
): Block {
  const lineHeightFactor = options.lineHeightFactor ?? 1.18;
  let fontSize = Math.round(options.maxFontSize);

  while (fontSize >= options.minFontSize) {
    const charsPerLine = Math.floor(options.maxWidth / (fontSize * 0.55));
    const lines = wrapText(text, charsPerLine);
    const height = lines.length * fontSize * lineHeightFactor;
    if (lines.length <= options.maxLines && height <= options.maxHeight) {
      return { lines, fontSize, lineHeight: fontSize * lineHeightFactor, truncated: false };
    }
    fontSize -= Math.max(1, Math.round(fontSize * 0.06));
  }

  const charsPerLine = Math.floor(options.maxWidth / (options.minFontSize * 0.55));
  const lines = wrapText(text, charsPerLine).slice(0, options.maxLines);
  const last = lines.length - 1;
  if (last >= 0) {
    const line = lines[last] ?? '';
    lines[last] =
      line.length > 2 ? `${line.slice(0, Math.max(1, line.length - 1)).trimEnd()}…` : line;
  }
  return {
    lines,
    fontSize: options.minFontSize,
    lineHeight: options.minFontSize * lineHeightFactor,
    truncated: true,
  };
}

function styleProfile(style: ImageStyle): {
  background: 'SOLID' | 'GRADIENT' | 'LIGHT';
  align: 'LEFT' | 'CENTER';
  headlineFactor: number;
  uppercase: boolean;
} {
  switch (style) {
    case 'BOLD':
      return { background: 'GRADIENT', align: 'CENTER', headlineFactor: 0.125, uppercase: true };
    case 'MINIMAL':
      return { background: 'LIGHT', align: 'LEFT', headlineFactor: 0.085, uppercase: false };
    case 'GRADIENT':
      return { background: 'GRADIENT', align: 'CENTER', headlineFactor: 0.1, uppercase: false };
    default:
      return { background: 'SOLID', align: 'LEFT', headlineFactor: 0.095, uppercase: false };
  }
}

export function composeImage(input: ComposeInput): ComposeResult {
  const { width: w, height: h } = input;
  const warnings: string[] = [];
  const random = rng(input.seed);
  const profile = styleProfile(input.style);

  const palette = input.palette.length > 0 ? [...input.palette] : DEFAULT_PALETTE.slice(0, 2);
  while (palette.length < 3) {
    palette.push(mix(palette[0] ?? DEFAULT_PALETTE[0]!, '#ffffff', 0.35));
  }
  const base = palette[0]!;
  const accent = palette[1] ?? mix(base, '#ffffff', 0.4);
  const tertiary = palette[2] ?? mix(accent, '#ffffff', 0.3);

  const light = profile.background === 'LIGHT';
  const background = light ? mix(base, '#ffffff', 0.9) : base;
  const onBackground = readableOn(background);
  const muted = mix(onBackground, background, 0.35);
  if (relativeLuminance(background) > 0.3 && relativeLuminance(background) < 0.6) {
    warnings.push(
      'Contraste limite entre le fond et le texte : vérifiez la lisibilité avant diffusion',
    );
  }

  const pad = Math.round(Math.min(w, h) * 0.075);
  const contentWidth = w - pad * 2;
  const centred = profile.align === 'CENTER';
  const anchorX = centred ? w / 2 : pad;
  const textAnchor = centred ? 'middle' : 'start';

  // --- Logo et badge ---
  const logoHeight = Math.round(pad * 0.85);
  const logoWidth = Math.round(contentWidth * 0.22);
  const hasLogo = Boolean(input.logoHref);
  if (!hasLogo) {
    warnings.push('Aucun logo fourni : le visuel repose uniquement sur la typographie');
  }

  const badge = input.badge;
  const badgeSize = Math.round(Math.min(w, h) * 0.026);
  const badgeHeight = Math.round(badgeSize * 2.1);

  // --- Pied de page et bouton ---
  const footerSize = Math.round(Math.min(w, h) * 0.026);
  const footerBaseline = h - pad;
  const ctaSize = Math.round(Math.min(w, h) * 0.032);
  const ctaHeight = Math.round(ctaSize * 2.4);
  const ctaGap = Math.round(pad * 0.4);

  let bottomReserve = pad + Math.round(footerSize * 1.3);
  if (input.callToAction) bottomReserve += ctaHeight + ctaGap;

  // --- Bloc de texte ---
  const textTop = pad + (hasLogo ? logoHeight : 0) + Math.round(pad * 0.55);
  const available = h - textTop - bottomReserve;
  const maxLines = input.format === 'STORY_9_16' ? 5 : input.format === 'LANDSCAPE_16_9' ? 3 : 4;

  let headlineBlock: Block | null = null;
  let subheadlineBlock: Block | null = null;

  if (input.headline) {
    const headline = profile.uppercase ? input.headline.toLocaleUpperCase('fr-FR') : input.headline;
    headlineBlock = fitBlock(headline, {
      maxWidth: contentWidth,
      maxHeight: available * (input.subheadline ? 0.68 : 1),
      maxLines,
      maxFontSize: Math.round(Math.min(w, h) * profile.headlineFactor),
      minFontSize: Math.round(Math.min(w, h) * 0.04),
      lineHeightFactor: 1.14,
    });
    if (headlineBlock.truncated) {
      warnings.push(
        'Le titre est trop long : il a été tronqué, raccourcissez-le pour éviter la coupure',
      );
    }
  }

  if (input.subheadline) {
    const remaining =
      available -
      (headlineBlock ? headlineBlock.lines.length * headlineBlock.lineHeight + pad * 0.3 : 0);
    subheadlineBlock = fitBlock(input.subheadline, {
      maxWidth: contentWidth,
      maxHeight: Math.max(Math.round(minHeight(w, h)), remaining * 0.8),
      maxLines: 4,
      maxFontSize: Math.round(Math.min(w, h) * 0.042),
      minFontSize: Math.round(Math.min(w, h) * 0.026),
      lineHeightFactor: 1.32,
    });
    if (subheadlineBlock.truncated) {
      warnings.push('Le sous-titre a été tronqué faute de place');
    }
  }

  // --- Décor déterministe ---
  const shapes: string[] = [];
  if (profile.background !== 'LIGHT') {
    for (let index = 0; index < 3; index += 1) {
      const radius = Math.round(Math.min(w, h) * (0.18 + random() * 0.22));
      const cx = Math.round(random() * w);
      const cy = Math.round(random() * h);
      const fill = [accent, tertiary, mix(accent, '#ffffff', 0.25)][index] ?? accent;
      shapes.push(
        `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${escapeXml(fill)}" opacity="0.18"/>`,
      );
    }
  } else {
    shapes.push(
      `<rect x="0" y="0" width="${w}" height="${Math.round(h * 0.012)}" fill="${escapeXml(accent)}"/>`,
    );
  }

  const backgroundMarkup =
    profile.background === 'GRADIENT'
      ? `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${escapeXml(
          mix(base, '#000000', 0.25),
        )}"/><stop offset="100%" stop-color="${escapeXml(mix(base, accent, 0.75))}"/></linearGradient></defs>
  <rect x="0" y="0" width="${w}" height="${h}" fill="url(#bg)"/>`
      : `<rect x="0" y="0" width="${w}" height="${h}" fill="${escapeXml(background)}"/>`;

  // --- Assemblage ---
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeXml(
      input.headline ?? input.brandName ?? 'Visuel généré',
    )}">`,
  );
  parts.push(`  ${backgroundMarkup}`);

  // Image de référence en fond, voilée pour préserver la lisibilité du texte.
  if (input.referenceHref) {
    parts.push(
      `  <image href="${escapeXml(input.referenceHref)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`,
      `  <rect x="0" y="0" width="${w}" height="${h}" fill="${escapeXml(background)}" opacity="0.62"/>`,
    );
  }

  for (const shape of shapes) parts.push(`  ${shape}`);

  if (hasLogo && input.logoHref) {
    parts.push(
      `  <image href="${escapeXml(input.logoHref)}" x="${pad}" y="${pad}" width="${logoWidth}" height="${logoHeight}" preserveAspectRatio="xMinYMid meet"/>`,
    );
  }

  if (badge) {
    const badgeWidth = Math.round(badge.length * badgeSize * 0.62 + badgeSize * 2);
    const badgeX = w - pad - badgeWidth;
    const badgeY = pad;
    parts.push(
      `  <rect x="${badgeX}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" rx="${Math.round(badgeHeight / 2)}" fill="${escapeXml(accent)}"/>`,
      `  <text x="${badgeX + badgeWidth / 2}" y="${badgeY + badgeHeight / 2}" fill="${escapeXml(
        readableOn(accent),
      )}" font-family="${FONT_STACK}" font-size="${badgeSize}" font-weight="700" text-anchor="middle" dominant-baseline="central">${escapeXml(
        badge,
      )}</text>`,
    );
  }

  let cursor = textTop;
  if (headlineBlock) {
    for (const [index, line] of headlineBlock.lines.entries()) {
      const baseline = cursor + headlineBlock.fontSize * 0.82 + index * headlineBlock.lineHeight;
      parts.push(
        `  <text x="${anchorX}" y="${Math.round(baseline)}" fill="${escapeXml(
          onBackground,
        )}" font-family="${FONT_STACK}" font-size="${headlineBlock.fontSize}" font-weight="800" letter-spacing="-0.02em" text-anchor="${textAnchor}">${escapeXml(
          line,
        )}</text>`,
      );
    }
    cursor += headlineBlock.lines.length * headlineBlock.lineHeight + pad * 0.3;
  }

  if (subheadlineBlock) {
    for (const [index, line] of subheadlineBlock.lines.entries()) {
      const baseline =
        cursor + subheadlineBlock.fontSize * 0.8 + index * subheadlineBlock.lineHeight;
      parts.push(
        `  <text x="${anchorX}" y="${Math.round(baseline)}" fill="${escapeXml(
          muted,
        )}" font-family="${FONT_STACK}" font-size="${subheadlineBlock.fontSize}" font-weight="400" text-anchor="${textAnchor}">${escapeXml(
          line,
        )}</text>`,
      );
    }
  }

  if (input.callToAction) {
    const ctaWidth = Math.round(
      Math.min(contentWidth, input.callToAction.length * ctaSize * 0.62 + ctaSize * 2.6),
    );
    const ctaX = centred ? Math.round((w - ctaWidth) / 2) : pad;
    const ctaY = footerBaseline - Math.round(footerSize * 1.3) - ctaGap - ctaHeight;
    parts.push(
      `  <rect x="${ctaX}" y="${ctaY}" width="${ctaWidth}" height="${ctaHeight}" rx="${Math.round(ctaHeight / 2)}" fill="${escapeXml(accent)}"/>`,
      `  <text x="${ctaX + ctaWidth / 2}" y="${ctaY + ctaHeight / 2}" fill="${escapeXml(
        readableOn(accent),
      )}" font-family="${FONT_STACK}" font-size="${ctaSize}" font-weight="700" text-anchor="middle" dominant-baseline="central">${escapeXml(
        input.callToAction,
      )}</text>`,
    );
  }

  const footerParts: string[] = [];
  if (input.brandName) {
    footerParts.push(`<tspan font-weight="700">${escapeXml(input.brandName)}</tspan>`);
  }
  if (input.slogan) {
    footerParts.push(
      `<tspan fill="${escapeXml(muted)}">${footerParts.length > 0 ? ' · ' : ''}${escapeXml(input.slogan)}</tspan>`,
    );
  }
  if (footerParts.length > 0) {
    parts.push(
      `  <text x="${pad}" y="${footerBaseline}" fill="${escapeXml(onBackground)}" font-family="${FONT_STACK}" font-size="${footerSize}" text-anchor="start">${footerParts.join('')}</text>`,
    );
  }

  parts.push('</svg>');

  return { svg: parts.join('\n'), warnings };
}

function minHeight(w: number, h: number): number {
  return Math.round(Math.min(w, h) * 0.06);
}
