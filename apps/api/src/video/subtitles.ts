import type { SubtitleFormat, SubtitleStyle, TranscriptSegment } from '@ass/shared';

/**
 * Génération et sérialisation des sous-titres.
 *
 * Module volontairement pur (aucune dépendance base ou réseau) : il est testé
 * unitairement et sera réutilisé tel quel par un worker de rendu ffmpeg.
 *
 * Sept styles sont couverts, conformément au cahier des charges (§5.4) :
 * professionnel, minimal, karaoké, mots-clés, dynamique, créateur, podcast.
 */

const MIN_CUE_SECONDS = 0.8;

/** Mots outils français : jamais mis en avant par le style « mots-clés ». */
const STOP_WORDS = new Set([
  'alors',
  'apres',
  'aussi',
  'autre',
  'avec',
  'avoir',
  'bien',
  'cela',
  'cette',
  'comme',
  'dans',
  'depuis',
  'donc',
  'elle',
  'encore',
  'entre',
  'etre',
  'faire',
  'pour',
  'plus',
  'quand',
  'sans',
  'sous',
  'tout',
  'tous',
  'tres',
  'votre',
  'vous',
  'nous',
  'mais',
  'leur',
  'leurs',
  'dont',
  'vers',
  'chez',
  'ici',
  'puis',
  'sur',
  'par',
  'les',
  'des',
  'une',
  'aux',
  'est',
  'que',
  'qui',
  'son',
  'ses',
  'mon',
  'mes',
  'nos',
  'vos',
  'ils',
  'elles',
  'ont',
  'sont',
  'ete',
  // Mots interrogatifs : jamais porteurs de sens dans une accroche mise en avant.
  'comment',
  'pourquoi',
  'quoi',
  'quel',
  'quelle',
  'quels',
  'quelles',
  'combien',
  'lequel',
  'laquelle',
]);

interface StyleConfig {
  /** Longueur maximale d'un cue. `Infinity` = pas de contrainte. */
  maxChars: number;
  /** Nombre maximal de mots par cue. `Infinity` = pas de contrainte. */
  maxWords: number;
  /** Découpe d'abord sur les fins de phrase, puis sur la longueur. */
  sentenceAware?: boolean;
  /** Met en majuscules les mots porteurs de sens. */
  uppercaseKeywords?: boolean;
}

export const STYLE_CONFIG: Record<SubtitleStyle, StyleConfig> = {
  // Une phrase par cue, redécoupée seulement si elle dépasse 84 caractères.
  PROFESSIONAL: { maxChars: 84, maxWords: Number.POSITIVE_INFINITY, sentenceAware: true },
  MINIMAL: { maxChars: 42, maxWords: Number.POSITIVE_INFINITY },
  KARAOKE: { maxChars: Number.POSITIVE_INFINITY, maxWords: 2 },
  KEYWORDS: { maxChars: 42, maxWords: Number.POSITIVE_INFINITY, uppercaseKeywords: true },
  DYNAMIC: { maxChars: 28, maxWords: 3 },
  CREATOR: { maxChars: 32, maxWords: Number.POSITIVE_INFINITY },
  PODCAST: { maxChars: 90, maxWords: Number.POSITIVE_INFINITY },
};

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

/** Retire la ponctuation de bord sans casser les traits d'union ni les apostrophes. */
function trimEdges(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function normaliseWord(word: string): string {
  return trimEdges(word)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Mots porteurs de sens, du plus long au plus court : sert aux titres de clips. */
export function salientWords(text: string, limit = 4): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const bare = trimEdges(word);
    const normalised = normaliseWord(word);
    if (bare.length < 5 || STOP_WORDS.has(normalised) || seen.has(normalised)) continue;
    seen.add(normalised);
    words.push(bare);
  }
  return words.sort((a, b) => b.length - a.length).slice(0, limit);
}

function emphasise(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const bare = trimEdges(word);
      const normalised = normaliseWord(word);
      if (bare.length < 6 || STOP_WORDS.has(normalised)) return word;
      return word.toUpperCase();
    })
    .join(' ');
}

/** Chunk les mots d'une phrase selon les limites de caractères et de mots du style. */
function chunkWords(text: string, config: StyleConfig): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  if (Number.isFinite(config.maxWords)) {
    const groups: string[] = [];
    for (let index = 0; index < words.length; index += config.maxWords) {
      groups.push(words.slice(index, index + config.maxWords).join(' '));
    }
    return groups;
  }

  const groups: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    const candidate = [...current, word].join(' ');
    if (candidate.length > config.maxChars && current.length > 0) {
      groups.push(current.join(' '));
      current = [word];
    } else {
      current.push(word);
    }
  }
  if (current.length > 0) groups.push(current.join(' '));
  return groups;
}

/** Découpe sur les fins de phrase sans perdre la ponctuation. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function groupWords(text: string, style: SubtitleStyle): string[] {
  const config = STYLE_CONFIG[style];
  const units = config.sentenceAware ? splitSentences(text) : [text];
  const groups = units.flatMap((unit) => chunkWords(unit, config));
  return config.uppercaseKeywords ? groups.map(emphasise) : groups;
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

function splitTime(seconds: number): [number, number, number, number] {
  const total = Math.max(0, Math.round(seconds * 1000));
  return [
    Math.floor(total / 3_600_000),
    Math.floor((total % 3_600_000) / 60_000),
    Math.floor((total % 60_000) / 1000),
    total % 1000,
  ];
}

/** Horodatage SRT : `HH:MM:SS,mmm`. */
export function formatSrtTime(seconds: number): string {
  const [hours, minutes, secs, millis] = splitTime(seconds);
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`;
}

/** Horodatage WebVTT : `HH:MM:SS.mmm` (virgule remplacée par un point). */
export function formatVttTime(seconds: number): string {
  return formatSrtTime(seconds).replace(',', '.');
}

export function toSrt(cues: TranscriptSegment[]): string {
  return `${cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}`,
    )
    .join('\n\n')}\n`;
}

export function toVtt(cues: TranscriptSegment[]): string {
  const blocks = cues.map(
    (cue, index) =>
      `${index + 1}\n${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${cue.text}`,
  );
  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}

export function toTxt(cues: TranscriptSegment[]): string {
  return `${cues.map((cue) => cue.text).join('\n')}\n`;
}

/** Sérialise des cues déjà calculées dans le format demandé. */
export function serializeCues(cues: TranscriptSegment[], format: SubtitleFormat): string {
  if (format === 'vtt') return toVtt(cues);
  if (format === 'txt') return toTxt(cues);
  return toSrt(cues);
}

export function countCues(segments: TranscriptSegment[], style: SubtitleStyle): number {
  return splitIntoCues(segments, style).length;
}
