import { describe, expect, it } from 'vitest';
import { buildWindows, suggestClips, DEFAULT_TARGET_DURATION, MAX_CLIPS } from './clips.js';

/** Transcription longue et variée : 12 segments de 5 s, soit 60 s au total. */
const longTranscript = [
  { start: 0, end: 5, text: 'Comment doubler sa portée organique sans budget publicitaire ?' },
  {
    start: 5,
    end: 10,
    text: 'La réponse tient dans la réutilisation méthodique du contenu existant.',
  },
  { start: 10, end: 15, text: 'Première étape, découper la vidéo source en passages autonomes.' },
  { start: 15, end: 20, text: 'Deuxième étape, vérifier que chaque passage se comprend seul.' },
  { start: 20, end: 25, text: 'Troisième étape, produire des sous-titres lisibles sur mobile.' },
  { start: 25, end: 30, text: 'Enfin, mesurer la rétention pour arbitrer les prochains formats.' },
  { start: 30, end: 35, text: 'Les créateurs efficaces publient peu mais publient juste.' },
  {
    start: 35,
    end: 40,
    text: 'Un format vertical bien calibré surpasse souvent un montage soigné.',
  },
  { start: 40, end: 45, text: 'Le silence tue la rétention dès les trois premières secondes.' },
  { start: 45, end: 50, text: 'Coupez les hésitations, gardez les affirmations.' },
  { start: 50, end: 55, text: 'Testez trois accroches différentes sur le même extrait.' },
  { start: 55, end: 60, text: 'Conservez celle qui retient le plus longtemps, puis itérez.' },
];

describe('extraction de clips (Mode A)', () => {
  it('regroupe les segments en fenêtres proches de la durée cible', () => {
    const windows = buildWindows(longTranscript, 30);
    expect(windows.length).toBeGreaterThanOrEqual(2);
    for (const window of windows) {
      expect(window.length).toBeGreaterThan(0);
      // Une fenêtre ne s'ouvre qu'une fois la cible atteinte.
      const span = window.at(-1)!.end - window[0]!.start;
      expect(span).toBeGreaterThanOrEqual(30);
    }
    expect(windows.flat()).toHaveLength(longTranscript.length);
  });

  it('ne perd aucun segment même si la vidéo est plus courte que la cible', () => {
    const windows = buildWindows(longTranscript.slice(0, 2), DEFAULT_TARGET_DURATION);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toHaveLength(2);
  });

  it('propose des clips bornés, ordonnés et non vides', () => {
    const clips = suggestClips(longTranscript, 30);
    expect(clips.length).toBeGreaterThan(0);
    expect(clips.length).toBeLessThanOrEqual(MAX_CLIPS);

    for (const clip of clips) {
      expect(clip.start).toBeGreaterThanOrEqual(0);
      expect(clip.end).toBeGreaterThan(clip.start);
      expect(clip.duration).toBeCloseTo(clip.end - clip.start, 1);
      expect(clip.score).toBeGreaterThanOrEqual(0);
      expect(clip.score).toBeLessThanOrEqual(100);
      expect(clip.title.length).toBeGreaterThan(0);
      expect(clip.summary.length).toBeGreaterThan(0);
      expect(clip.rationale.length).toBeGreaterThan(0);
    }
  });

  it('classe les clips du plus pertinent au moins pertinent', () => {
    const scores = suggestClips(longTranscript, 30).map((clip) => clip.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('reste déterministe pour une même entrée', () => {
    expect(suggestClips(longTranscript, 30)).toEqual(suggestClips(longTranscript, 30));
  });

  it('récompense une ouverture sur une question', () => {
    const withHook = suggestClips(longTranscript, 30)[0]!;
    expect(withHook.start).toBe(0);
    expect(withHook.rationale).toMatch(/question|accroche|autonome|durée/);
  });

  it('titre le clip avec la phrase d’ouverture, pas une liste de mots', () => {
    const [first] = suggestClips(longTranscript, 30);
    expect(first!.title).toBe('Comment doubler sa portée organique sans budget publicitaire ?');
    // Un titre lisible contient des espaces et ne ressemble pas à un nuage de mots-clés.
    expect(first!.title).toContain(' ');
    expect(first!.title).not.toMatch(/·/);
  });

  it('conserve les traits d’union dans les titres de repli', () => {
    const short = [{ start: 0, end: 3, text: 'Sous-titrez.' }];
    const [clip] = suggestClips(short, 30);
    expect(clip!.title).not.toContain('soustitrez');
  });

  it('pénalise un passage saturé de silence', () => {
    const sparse = [
      { start: 0, end: 30, text: 'Bonjour.' },
      { start: 30, end: 60, text: 'Voilà.' },
    ];
    const clips = suggestClips(sparse, 30);
    expect(clips[0]!.rationale).toMatch(/silence/);
    expect(clips[0]!.score).toBeLessThan(70);
  });

  it('accepte une durée cible personnalisée', () => {
    const short = suggestClips(longTranscript, 15);
    const long = suggestClips(longTranscript, 60);
    expect(short.length).toBeGreaterThan(long.length);
    for (const clip of short) {
      expect(clip.duration).toBeLessThanOrEqual(20);
    }
  });

  it('renvoie une liste vide sans transcription', () => {
    expect(suggestClips([], 30)).toEqual([]);
  });
});
