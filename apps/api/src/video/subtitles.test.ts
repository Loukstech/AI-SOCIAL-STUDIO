import { describe, expect, it } from 'vitest';
import { buildDemoSegments, countCues, formatSrtTime, splitIntoCues, toSrt } from './subtitles.js';

const segments = buildDemoSegments({
  name: 'Campagne de lancement',
  description: 'Une vidéo courte qui présente la nouvelle collection et son univers.',
});

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

  it('garde un cue par segment en style professionnel', () => {
    expect(countCues(segments, 'PROFESSIONAL')).toBe(segments.length);
    const srt = toSrt(segments, 'PROFESSIONAL');
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
    // Les cues restent dans les bornes du segment d'origine.
    expect(cues[0]!.start).toBe(0);
    expect(cues.at(-1)!.end).toBe(segments.at(-1)!.end);
  });

  it('numérote les cues de façon contiguë', () => {
    const srt = toSrt(segments, 'KARAOKE');
    const indexes = srt
      .split('\n\n')
      .map((block) => Number.parseInt(block.split('\n')[0] ?? '', 10))
      .filter((value) => !Number.isNaN(value));
    expect(indexes).toEqual(indexes.map((_, index) => index + 1));
  });
});
