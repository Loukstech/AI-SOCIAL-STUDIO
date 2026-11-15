import type { SubtitleStyle, TranscriptSegment } from '@ass/shared';

/**
 * Génération de sous-titres au format SRT.
 *
 * Module volontairement pur (aucune dépendance base ou réseau) : il est testé
 * unitairement et sera réutilisé tel quel par un worker de rendu ffmpeg.
 */

const MINIMAL_MAX_CHARS = 42;
const KARAOKE_WORDS_PER_CUE = 2;
const MIN_CUE_SECONDS = 0.8;

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Transcription de démonstration, déterministe, utilisée tant qu'aucun fournisseur IA n'est branché. */
export function buildDemoSegments(input: {
  name: string;
  description?: string | null;
}): TranscriptSegment[] {
  const intro = `Bienvenue dans ${input.name}.`;
  const body =
    input.description?.trim() || 'Présentation du projet vidéo et de ses objectifs éditoriaux.';
  const outro = 'Sous-titres générés par AI Social Studio, prêts à être relus et ajustés.';
  return [
    { start: 0, end: 3.2, text: intro },
    { start: 3.2, end: 7.6, text: body },
    { start: 7.6, end: 11, text: outro },
  ];
}

function groupWords(text: string, style: SubtitleStyle): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (style === 'PROFESSIONAL') return [words.join(' ')];

  const groups: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    if (style === 'KARAOKE') {
      current.push(word);
      if (current.length === KARAOKE_WORDS_PER_CUE) {
        groups.push(current.join(' '));
        current = [];
      }
      continue;
    }
    const candidate = [...current, word].join(' ');
    if (candidate.length > MINIMAL_MAX_CHARS && current.length > 0) {
      groups.push(current.join(' '));
      current = [word];
    } else {
      current.push(word);
    }
  }
  if (current.length > 0) groups.push(current.join(' '));
  return groups;
}

/** Découpe les segments selon le style et répartit la durée au prorata des caractères. */
export function splitIntoCues(
  segments: TranscriptSegment[],
  style: SubtitleStyle,
): TranscriptSegment[] {
  const cues: TranscriptSegment[] = [];
  for (const segment of segments) {
    const groups = groupWords(segment.text, style);
    if (groups.length === 0) continue;
    if (groups.length === 1) {
      cues.push({ start: round(segment.start), end: round(segment.end), text: groups[0]! });
      continue;
    }
    const totalChars = groups.reduce((total, group) => total + group.length, 0);
    const duration = Math.max(0, segment.end - segment.start);
    let cursor = segment.start;
    groups.forEach((text, index) => {
      const isLast = index === groups.length - 1;
      const share = totalChars > 0 ? text.length / totalChars : 1 / groups.length;
      const span = isLast
        ? Math.max(0, segment.end - cursor)
        : Math.max(MIN_CUE_SECONDS, share * duration);
      const end = isLast ? segment.end : Math.min(segment.end, cursor + span);
      cues.push({ start: round(cursor), end: round(end), text });
      cursor = end;
    });
  }
  return cues;
}

export function formatSrtTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const secs = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`;
}

export function toSrt(segments: TranscriptSegment[], style: SubtitleStyle): string {
  const cues = splitIntoCues(segments, style);
  return `${cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}`,
    )
    .join('\n\n')}\n`;
}

export function countCues(segments: TranscriptSegment[], style: SubtitleStyle): number {
  return splitIntoCues(segments, style).length;
}
