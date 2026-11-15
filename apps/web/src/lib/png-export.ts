/**
 * Export PNG des visuels (§7).
 *
 * Le SVG est converti en PNG **dans le navigateur**, via un canvas. Trois
 * raisons à ce choix :
 *
 * 1. **Typographie exacte.** Le rendu canvas utilise les polices de la machine
 *    qui affiche l'aperçu. Un rendu serveur tournerait dans un conteneur où
 *    `Inter` n'est pas installée : les métriques changeraient, et un titre
 *    ajusté au pixel près déborderait.
 * 2. **Aucune dépendance native.** Pas de `sharp`, pas de `resvg`, pas de
 *    `librsvg` à compiler : le déploiement reste identique.
 * 3. **Le fichier est produit là où l'utilisateur le voit.**
 *
 * Limite connue et traitée explicitement : un SVG chargé comme image est rendu
 * en « mode statique sécurisé », donc les ressources externes (logo, photo de
 * référence) sont **bloquées**. On les intègre donc en amont sous forme de
 * `data:` URI ; si le CDN refuse la requête (CORS), on le dit au lieu de livrer
 * un PNG silencieusement amputé.
 */

export interface InlineResult {
  svg: string;
  /** Ressources qui n'ont pas pu être intégrées, avec leur cause. */
  warnings: string[];
}

export interface PngOptions {
  /** Facteur d'échelle : 1 = dimensions natives, 2 = double densité. */
  scale?: number;
  /** Couleur de fond appliquée avant le dessin (le SVG couvre déjà tout). */
  background?: string;
}

/** Extrait les URL externes référencées par des `<image href="…">`. */
export function externalImageUrls(svg: string): string[] {
  const urls = new Set<string>();
  for (const match of svg.matchAll(/<image\b[^>]*\bhref="([^"]+)"/g)) {
    const href = (match[1] ?? '').replace(/&amp;/g, '&');
    if (/^https?:\/\//i.test(href)) urls.add(href);
  }
  return [...urls];
}

async function toDataUrl(url: string): Promise<string> {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('lecture du fichier impossible'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Remplace les images externes par leur contenu encodé, pour que le rendu
 * canvas ne perde ni le logo ni la photo de référence.
 */
export async function inlineSvgAssets(svg: string): Promise<InlineResult> {
  const urls = externalImageUrls(svg);
  if (urls.length === 0) return { svg, warnings: [] };

  const warnings: string[] = [];
  let next = svg;

  for (const url of urls) {
    try {
      const dataUrl = await toDataUrl(url);
      next = next.split(url).join(dataUrl);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'échec réseau';
      const name = url.split('/').pop() ?? url;
      warnings.push(
        `${name} n’a pas pu être intégré au PNG (${reason}) : l’export ne contiendra pas cet élément`,
      );
    }
  }

  return { svg: next, warnings };
}

/** Charge un SVG dans une `Image` prête à être dessinée. */
function loadImage(svg: string): Promise<HTMLImageElement> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Le SVG n’a pas pu être interprété'));
    };
    image.src = objectUrl;
  });
}

/** Convertit une source SVG en PNG, aux dimensions demandées. */
export async function svgToPng(
  svg: string,
  width: number,
  height: number,
  options: PngOptions = {},
): Promise<Blob> {
  const scale = options.scale ?? 1;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Dimensions invalides');
  }

  const canvasWidth = Math.round(width * scale);
  const canvasHeight = Math.round(height * scale);
  // Garde-fou : au-delà, les navigateurs refusent d'allouer le canvas.
  if (canvasWidth * canvasHeight > 40_000_000) {
    throw new Error('Visuel trop grand pour un export PNG dans le navigateur');
  }

  const image = await loadImage(svg);
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponible dans ce navigateur');

  if (options.background) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, canvasWidth, canvasHeight);
  }
  context.drawImage(image, 0, 0, canvasWidth, canvasHeight);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Encodage PNG impossible');
  return blob;
}

export interface PngExport {
  blob: Blob;
  warnings: string[];
  filename: string;
}

/** Chaîne complète : intégration des ressources, rendu, nommage. */
export async function exportPng(input: {
  svg: string;
  width: number;
  height: number;
  filename: string;
  scale?: number;
}): Promise<PngExport> {
  const { svg, warnings } = await inlineSvgAssets(input.svg);
  const blob = await svgToPng(svg, input.width, input.height, { scale: input.scale });
  const suffix = (input.scale ?? 1) > 1 ? `@${input.scale}x` : '';
  const base = input.filename.replace(/\.png$/i, '');
  return { blob, warnings, filename: `${base}${suffix}.png` };
}

/** Déclenche le téléchargement d'un blob côté navigateur. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Laisse au navigateur le temps d'amorcer le téléchargement.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
