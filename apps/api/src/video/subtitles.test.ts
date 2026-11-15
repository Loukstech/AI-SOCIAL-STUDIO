import { describe, expect, it } from 'vitest';
import { subtitleStyles } from '@ass/shared';
import {
  buildDemoSegments,
  countCues,
  formatSrtTime,
  formatVttTime,
  serializeCues,
  splitIntoCues,
  toSrt,
  toTxt,
  toVtt,
} from './subtitles.js';

const segments = buildDemoSegments({
  name: 'Campagne de lancement',
  description: 'Une vidéo courte qui présente la nouvelle collection et son univers.',
});

const longSegments = [
  {
    start: 0,
    end: 6,
    text: 'Comment transformer une simple vidéo en campagne performante ? La méthode tient en trois étapes.',
  },
  {
    start: 6,
    end: 12,
    text: 'Analysez la transcription, isolez les passages autonomes, puis générez les sous-titres.',
  },
];

describe('sous-titres', () => {
  it('produit une transcription de démonstration ordonnée', () => {
    expect(segments).toHaveLength(3);
    expect(segments[0]!.start).toBe(0);
    expect(segments[0]!.text).toContain('Campagne de lancement');
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index]!.start).toBeGreaterThanOrEqual(segments[index - 1]!.end);
      expect(segments[index]!.end).toBeGreaterThan(segments[index]!.start);
    }
  });

  it('formate les temps au format SRT', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000');
    expect(formatSrtTime(3.2)).toBe('00:00:03,200');
    expect(formatSrtTime(3725.5)).toBe('01:02:05,500');
    expect(formatSrtTime(-4)).toBe('00:00:00,000');
  });

  it('formate les temps au format WebVTT', () => {
    expect(formatVttTime(3.2)).toBe('00:00:03.200');
    expect(formatVttTime(3725.5)).toBe('01:02:05.500');
  });

  it('garde un cue par segment en style professionnel', () => {
    expect(countCues(segments, 'PROFESSIONAL')).toBe(segments.length);
    const srt = toSrt(splitIntoCues(segments, 'PROFESSIONAL'));
    expect(srt.startsWith('1\n00:00:00,000 --> 00:00:03,200\n')).toBe(true);
    expect(srt.trim().split('\n\n')).toHaveLength(segments.length);
    expect(srt.endsWith('\n')).toBe(true);
  });

  it('découpe en groupes de deux mots en style karaoké', () => {
    const cues = splitIntoCues(segments, 'KARAOKE');
    expect(cues.length).toBeGreaterThan(segments.length);
    for (const cue of cues) {
      expect(cue.text.split(/\s+/).length).toBeLessThanOrEqual(2);
      expect(cue.end).toBeGreaterThanOrEqual(cue.start);
    }
  });

  it('limite la longueur des lignes en style minimal', () => {
    const cues = splitIntoCues(segments, 'MINIMAL');
    expect(cues.length).toBeGreaterThanOrEqual(segments.length);
    for (const cue of cues) {
      expect(cue.text.length).toBeLessThanOrEqual(42);
    }
    expect(cues[0]!.start).toBe(0);
    expect(cues.at(-1)!.end).toBe(segments.at(-1)!.end);
  });

  it('numérote les cues de façon contiguë', () => {
    const srt = toSrt(splitIntoCues(segments, 'KARAOKE'));
    const indexes = srt
      .split('\n\n')
      .map((block) => Number.parseInt(block.split('\n')[0] ?? '', 10))
      .filter((value) => !Number.isNaN(value));
    expect(indexes).toEqual(indexes.map((_, index) => index + 1));
  });

  it('couvre les sept styles du cahier des charges', () => {
    expect(subtitleStyles).toHaveLength(7);
    for (const style of subtitleStyles) {
      const cues = splitIntoCues(longSegments, style);
      expect(cues.length).toBeGreaterThan(0);
      for (const cue of cues) {
        expect(cue.end).toBeGreaterThanOrEqual(cue.start);
        expect(cue.text.trim().length).toBeGreaterThan(0);
      }
      // Aucune cue ne dépasse la durée de la transcription d'origine.
      expect(cues.at(-1)!.end).toBeLessThanOrEqual(longSegments.at(-1)!.end + 0.001);
    }
  });

  it('borne les styles courts en longueur et en mots', () => {
    for (const [style, maxChars, maxWords] of [
      ['DYNAMIC', 28, 3],
      ['CREATOR', 32, Number.POSITIVE_INFINITY],
      ['PODCAST', 90, Number.POSITIVE_INFINITY],
    ] as const) {
      for (const cue of splitIntoCues(longSegments, style)) {
        expect(cue.text.length).toBeLessThanOrEqual(maxChars);
        expect(cue.text.split(/\s+/).length).toBeLessThanOrEqual(maxWords);
      }
    }
  });

  it('met en avant les mots porteurs en style mots-clés', () => {
    const cues = splitIntoCues(longSegments, 'KEYWORDS');
    const joined = cues.map((cue) => cue.text).join(' ');
    expect(joined).toMatch(/TRANSCRIPTION|PASSAGES|AUTONOMES|SOUS-TITRES|CAMPAGNE/);
    // Les mots outils restent en minuscules.
    expect(joined).not.toMatch(/\bCOMMENT\b/);
  });

  it('produit un WebVTT valide', () => {
    const vtt = toVtt(splitIntoCues(segments, 'MINIMAL'));
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toMatch(/00:00:00\.000 --> 00:00:03\.200/);
    expect(vtt).not.toContain(',000');
    expect(vtt.endsWith('\n')).toBe(true);
  });

  it('produit un export texte brut, une ligne par cue', () => {
    const cues = splitIntoCues(segments, 'PROFESSIONAL');
    const txt = toTxt(cues);
    expect(txt.trim().split('\n')).toHaveLength(cues.length);
    expect(txt).not.toContain('-->');
  });

  it('sérialise selon le format demandé', () => {
    const cues = splitIntoCues(segments, 'MINIMAL');
    expect(serializeCues(cues, 'srt')).toContain('-->');
    expect(serializeCues(cues, 'vtt').startsWith('WEBVTT')).toBe(true);
    expect(serializeCues(cues, 'txt')).not.toContain('-->');
  });
});
