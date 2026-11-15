import type { TranscriptSegment } from '@ass/shared';
import { salientWords } from './subtitles.js';

/**
 * Mode A — extraction des meilleurs passages (§5.2 et §22.1).
 *
 * Heuristique déterministe, sans appel externe : elle classe des fenêtres de la
 * transcription selon l'accroche, la densité de parole, l'autonomie du passage,
 * la proximité avec la durée cible et la richesse lexicale. Le score n'est pas
 * une vérité : c'est une aide au tri, l'utilisateur garde le dernier mot.
 */

export interface ClipDraft {
  title: string;
  summary: string;
  start: number;
  end: number;
  duration: number;
  score: number;
  rationale: string;
}

export const DEFAULT_TARGET_DURATION = 30;
export const MAX_CLIPS = 6;

/** Mots qui signalent une accroche éditoriale. */
const HOOK_WORDS = [
  'comment',
  'pourquoi',
  'secret',
  'erreur',
  'jamais',
  'toujours',
  'meilleur',
  'gratuit',
  'rapide',
  'simple',
  'attention',
  'important',
  'resultat',
  'objectif',
  'promesse',
];

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Regroupe les segments en fenêtres d'environ `targetDuration` secondes. */
export function buildWindows(
  segments: TranscriptSegment[],
  targetDuration: number,
): TranscriptSegment[][] {
  if (segments.length === 0) return [];
  const windows: TranscriptSegment[][] = [];
  let current: TranscriptSegment[] = [];
  for (const segment of segments) {
    current.push(segment);
    const span = (current.at(-1)?.end ?? 0) - (current[0]?.start ?? 0);
    if (span >= targetDuration) {
      windows.push(current);
      current = [];
    }
  }
  if (current.length > 0) windows.push(current);
  return windows;
}

function scoreWindow(
  window: TranscriptSegment[],
  targetDuration: number,
  index: number,
  total: number,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const text = window.map((segment) => segment.text).join(' ');
  const start = window[0]!.start;
  const end = window.at(-1)!.end;
  const duration = Math.max(0.1, end - start);
  const words = text.split(/\s+/).filter(Boolean);

  let score = 40;

  // 1. Accroche : question, chiffre ou mot déclencheur dans les deux premiers segments.
  const opening = normalise(
    window
      .slice(0, 2)
      .map((segment) => segment.text)
      .join(' '),
  );
  const hasQuestion = opening.includes('?');
  const hasNumber = /\d/.test(opening);
  const hasHook = HOOK_WORDS.some((word) => opening.includes(word));
  if (hasQuestion || hasHook) {
    score += 14;
    reasons.push(hasQuestion ? 'ouvre sur une question' : 'ouvre sur une accroche forte');
  } else if (hasNumber) {
    score += 7;
    reasons.push('chiffre dès l’ouverture');
  }

  // 2. Densité de parole : trop de silence dilue un clip court.
  const wordsPerSecond = words.length / duration;
  if (wordsPerSecond >= 2 && wordsPerSecond <= 4.5) {
    score += 12;
    reasons.push('débit régulier');
  } else if (wordsPerSecond < 1) {
    score -= 12;
    reasons.push('beaucoup de silence');
  } else if (wordsPerSecond > 6) {
    score -= 6;
    reasons.push('débit trop rapide');
  }

  // 3. Autonomie : commence et finit sur une frontière de phrase.
  const startsClean = /^[\p{Lu}\p{N}]/u.test(window[0]!.text.trim());
  const endsClean = /[.!?…]$/u.test(window.at(-1)!.text.trim());
  if (startsClean && endsClean) {
    score += 13;
    reasons.push('passage autonome');
  } else if (startsClean) {
    score += 5;
  } else {
    score -= 5;
    reasons.push('démarre en milieu de phrase');
  }

  // 4. Proximité avec la durée cible.
  const ratio = duration / targetDuration;
  if (ratio >= 0.75 && ratio <= 1.25) {
    score += 16;
    reasons.push('durée conforme à la cible');
  } else if (ratio < 0.4) {
    score -= 14;
    reasons.push('trop court pour la cible');
  } else if (ratio > 1.6) {
    score -= 10;
    reasons.push('dépasse nettement la cible');
  }

  // 5. Richesse lexicale : évite les passages répétitifs.
  //    Sous 6 mots, l'échantillon est trop petit pour être significatif : on
  //    pénalise explicitement le manque de contenu parlé.
  if (words.length < 6) {
    score -= 15;
    reasons.push('très peu de contenu parlé');
  } else {
    const unique = new Set(words.map(normalise)).size;
    const lexicalRatio = unique / words.length;
    if (lexicalRatio >= 0.6) {
      score += 9;
      reasons.push('vocabulaire varié');
    } else if (lexicalRatio < 0.4) {
      score -= 7;
      reasons.push('répétitions nombreuses');
    }
  }

  // 6. Cold open : le premier passage d'une vidéo retient mieux.
  if (index === 0 && total > 1) {
    score += 4;
    reasons.push('début de vidéo');
  }

  return { score: clamp(Math.round(score), 0, 100), reasons };
}

/**
 * Titre du clip : on privilégie la première phrase du passage, qui porte
 * l'accroche réelle. Les mots-clés ne servent que de repli quand cette phrase
 * est trop courte pour être un titre lisible.
 */
function buildTitle(window: TranscriptSegment[]): string {
  const firstSentence = (window[0]!.text.split(/(?<=[.!?…])\s+/u)[0] ?? window[0]!.text)
    .replace(/[.!…]+$/u, '')
    .trim();

  if (firstSentence.length >= 12) {
    const capped =
      firstSentence.length > 70
        ? `${firstSentence.slice(0, firstSentence.lastIndexOf(' ', 70) > 40 ? firstSentence.lastIndexOf(' ', 70) : 70)}…`
        : firstSentence;
    return capped.charAt(0).toUpperCase() + capped.slice(1);
  }

  const words = salientWords(window.map((segment) => segment.text).join(' '), 4);
  const title = words.join(' · ');
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function buildSummary(window: TranscriptSegment[]): string {
  const text = window
    .map((segment) => segment.text)
    .join(' ')
    .trim();
  if (text.length <= 160) return text;
  const cut = text.slice(0, 160);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 100 ? lastSpace : 160)}…`;
}

/** Propose des clips classés du plus pertinent au moins pertinent. */
export function suggestClips(
  segments: TranscriptSegment[],
  targetDuration: number = DEFAULT_TARGET_DURATION,
): ClipDraft[] {
  const windows = buildWindows(segments, targetDuration);
  const drafts = windows.map((window, index) => {
    const { score, reasons } = scoreWindow(window, targetDuration, index, windows.length);
    const start = round(window[0]!.start);
    const end = round(window.at(-1)!.end);
    return {
      title: buildTitle(window),
      summary: buildSummary(window),
      start,
      end,
      duration: round(end - start),
      score,
      rationale: reasons.length > 0 ? reasons.join(', ') : 'passage neutre',
    };
  });

  return drafts.sort((a, b) => b.score - a.score || a.start - b.start).slice(0, MAX_CLIPS);
}
