import type { ContentLanguage, ContentTone, RewriteAction, SocialPlatform } from '@ass/shared';
import { platformSpecs } from '@ass/shared';
import { clampToLimit } from './content-generator.js';

/**
 * Assistant rédactionnel (§6.4).
 *
 * Neuf actions, toutes déterministes et sans appel externe. Elles opèrent sur
 * le texte déjà produit : l'utilisateur garde la main et voit immédiatement le
 * résultat, sans consommer de crédit IA.
 */

export interface AssistantInput {
  body: string;
  hashtags: string[];
  callToAction: string | null;
  platform: SocialPlatform;
  language: ContentLanguage;
  tone: ContentTone;
  /** Sujet du brief, utilisé pour reconstruire un appel à l'action pertinent. */
  subject: string;
}

export interface AssistantResult {
  body: string;
  hashtags: string[];
  callToAction: string | null;
  note: string;
}

/** Connecteurs et lexique par ton, pour l'action « changer le ton ». */
const TONE_MARKERS: Record<
  ContentLanguage,
  Record<ContentTone, { openers: string[]; swap: [RegExp, string][]; suffix: string }>
> = {
  FR: {
    PROFESSIONAL: {
      openers: ['À retenir.', 'Point d’étape.'],
      swap: [
        [/\bsuper\b/gi, 'solide'],
        [/\b génial\b/gi, ' pertinent'],
        [/\bvraiment\b/gi, 'réellement'],
        [/!/g, '.'],
      ],
      suffix: 'Nous restons disponibles pour en discuter.',
    },
    DYNAMIC: {
      openers: ['Ça avance vite.', 'Nouveauté de la semaine.'],
      swap: [
        [/\bnous proposons\b/gi, 'on propose'],
        [/\bactuellement\b/gi, 'en ce moment'],
        [/\bpar conséquent\b/gi, 'du coup'],
      ],
      suffix: 'La suite arrive très vite.',
    },
    FRIENDLY: {
      openers: ['Bonne nouvelle.', 'On a quelque chose à vous dire.'],
      swap: [
        [/\bnous\b/gi, 'on'],
        [/\bactuellement\b/gi, 'en ce moment'],
      ],
      suffix: 'On avait hâte de vous le partager.',
    },
    EXPERT: {
      openers: ['Ce qu’il faut savoir.', 'Décryptage.'],
      swap: [
        [/\bun peu\b/gi, 'modérément'],
        [/\btrès\b/gi, 'nettement'],
      ],
      suffix: 'Le sujet mérite d’être creusé.',
    },
    INSPIRING: {
      openers: ['Et si on voyait plus loin ?', 'Une idée pour demain.'],
      swap: [
        [/\boutil\b/gi, 'levier'],
        [/\butile\b/gi, 'précieux'],
      ],
      suffix: 'Le meilleur moment pour commencer, c’est maintenant.',
    },
    PLAYFUL: {
      openers: ['Alerte info.', 'Bon, on vous dit tout.'],
      swap: [
        [/\btrès\b/gi, 'carrément'],
        [/\bbeaucoup\b/gi, 'un paquet'],
      ],
      suffix: 'Voilà, c’était dit.',
    },
  },
  EN: {
    PROFESSIONAL: {
      openers: ['Worth noting.', 'A quick update.'],
      swap: [
        [/\bawesome\b/gi, 'solid'],
        [/\breally\b/gi, 'genuinely'],
        [/!/g, '.'],
      ],
      suffix: 'Happy to discuss further.',
    },
    DYNAMIC: {
      openers: ['Moving fast.', 'New this week.'],
      swap: [[/\bwe offer\b/gi, 'we ship']],
      suffix: 'More very soon.',
    },
    FRIENDLY: {
      openers: ['Good news.', 'Something we wanted to share.'],
      swap: [[/\bwe\b/gi, 'we']],
      suffix: 'We could not wait to tell you.',
    },
    EXPERT: {
      openers: ['What you need to know.', 'Breaking it down.'],
      swap: [[/\bvery\b/gi, 'markedly']],
      suffix: 'This deserves a deeper look.',
    },
    INSPIRING: {
      openers: ['What if we looked further?', 'An idea for tomorrow.'],
      swap: [[/\btool\b/gi, 'lever']],
      suffix: 'The best time to start is now.',
    },
    PLAYFUL: {
      openers: ['Heads up.', 'Okay, full disclosure.'],
      swap: [[/\bvery\b/gi, 'seriously']],
      suffix: 'There, we said it.',
    },
  },
};

const STOP_WORDS = new Set([
  'avec',
  'pour',
  'dans',
  'cette',
  'notre',
  'votre',
  'leurs',
  'plus',
  'tout',
  'tous',
  'être',
  'avoir',
  'faire',
  'sans',
  'sous',
  'entre',
  'comme',
  'mais',
  'donc',
  'aussi',
  'autre',
  'encore',
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'from',
  'your',
  'our',
  'new',
]);

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function capitalise(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Corrige les défauts mécaniques les plus fréquents. */
export function fixText(body: string): string {
  return body
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[^\s\n])/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => capitalise(line.trim()))
    .join('\n')
    .trim();
}

/** Connecteur d'enchaînement propre à chaque ton, toujours grammatical. */
const BRIDGES: Record<ContentLanguage, Record<ContentTone, string>> = {
  FR: {
    PROFESSIONAL: 'Autrement dit,',
    DYNAMIC: 'Concrètement,',
    FRIENDLY: 'En pratique,',
    EXPERT: 'Plus précisément,',
    INSPIRING: 'Et surtout,',
    PLAYFUL: 'Et franchement,',
  },
  EN: {
    PROFESSIONAL: 'In other words,',
    DYNAMIC: 'Concretely,',
    FRIENDLY: 'In practice,',
    EXPERT: 'More precisely,',
    INSPIRING: 'And above all,',
    PLAYFUL: 'And frankly,',
  },
};

/** Reformule en variant les connecteurs d'ouverture et de liaison. */
export function rephrase(body: string, language: ContentLanguage, tone: ContentTone): string {
  const parts = sentences(body);
  if (parts.length === 0) return body;

  const bridge = BRIDGES[language][tone];
  const rest = parts.slice(1);
  const rewritten = rest.map((sentence, index) => {
    if (index === 1 && sentence.length > 30) {
      return `${bridge} ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
    }
    return sentence;
  });

  return [parts[0]!, ...rewritten].join('\n\n');
}

/** Raccourcit en conservant l'accroche et l'appel à l'action. */
export function shorten(body: string, limit: number): string {
  if (body.length <= limit) return body;
  const parts = sentences(body);
  if (parts.length <= 1) return clampToLimit(body, limit);

  const kept: string[] = [parts[0]!];
  const tail = parts.at(-1)!;
  for (const sentence of parts.slice(1, -1)) {
    const candidate = [...kept, sentence, tail].join(' ');
    if (candidate.length > limit) break;
    kept.push(sentence);
  }
  if (kept.length === 1 && tail !== parts[0]) kept.push(tail);
  return kept.join('\n\n');
}

/** Développe en ajoutant un paragraphe de contexte et un bénéfice. */
export function expand(body: string, language: ContentLanguage, subject: string): string {
  const addition =
    language === 'FR'
      ? `Pourquoi c’est utile : ${subject} reste un sujet concret, avec des effets mesurables dès les premières semaines.`
      : `Why it matters: ${subject} is a concrete topic, with measurable effects within the first weeks.`;
  return `${body}\n\n${addition}`;
}

/** Applique un changement de ton par substitution lexicale et ponctuation. */
export function changeTone(body: string, language: ContentLanguage, tone: ContentTone): string {
  const markers = TONE_MARKERS[language][tone];
  let next = body;
  for (const [pattern, replacement] of markers.swap) {
    next = next.replace(pattern, replacement);
  }
  const opener = markers.openers[0]!;
  const already = next.startsWith(opener);
  return already ? next : `${opener} ${next.charAt(0).toUpperCase()}${next.slice(1)}`;
}

/** Ajoute un appel à l'action si absent. */
export function addCallToAction(
  body: string,
  cta: string | null,
  platform: SocialPlatform,
  language: ContentLanguage,
): { body: string; callToAction: string } {
  const action =
    cta ??
    (language === 'FR'
      ? platformSpecs[platform].label === 'LinkedIn'
        ? 'Et vous, comment abordez-vous le sujet ?'
        : 'Dites-nous ce que vous en pensez en commentaire.'
      : 'Tell us what you think in the comments.');
  if (body.includes(action)) return { body, callToAction: action };
  return { body: `${body}\n\n${action}`, callToAction: action };
}

/** Propose des hashtags à partir du texte, sans dépasser la limite de la plateforme. */
export function proposeHashtags(
  body: string,
  subject: string,
  language: ContentLanguage,
  platform: SocialPlatform,
): string[] {
  const source = `${subject} ${body}`;
  const words = source
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word.toLowerCase()));

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const word of words) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(`#${capitalise(word)}`);
  }

  const generic =
    language === 'FR' ? ['#Communication', '#RéseauxSociaux'] : ['#Marketing', '#SocialMedia'];
  return [...new Set([...tags, ...generic])].slice(0, platformSpecs[platform].maxHashtags);
}

/** Produit plusieurs variantes d'ouverture, pour A/B tester. */
export function variations(body: string, language: ContentLanguage, tone: ContentTone): string[] {
  const markers = TONE_MARKERS[language][tone];
  const parts = sentences(body);
  const rest = parts.slice(1).join(' ');
  return markers.openers.map((opener) =>
    rest ? `${opener} ${rest.charAt(0).toUpperCase()}${rest.slice(1)}` : `${opener} ${body}`,
  );
}

/** Traduit en changeant de langue : le générateur reconstruit le texte cible. */
export function applyAction(action: RewriteAction, input: AssistantInput): AssistantResult {
  const { body, hashtags, callToAction, platform, language, tone, subject } = input;
  const limit = platformSpecs[platform].maxChars;

  switch (action) {
    case 'FIX':
      return {
        body: fixText(body),
        hashtags,
        callToAction,
        note:
          language === 'FR'
            ? 'Espaces et majuscules normalisés.'
            : 'Spacing and capitals normalised.',
      };

    case 'REPHRASE':
      return {
        body: rephrase(body, language, tone),
        hashtags,
        callToAction,
        note: language === 'FR' ? 'Formulation retravaillée.' : 'Wording reworked.',
      };

    case 'SHORTEN': {
      const target = Math.min(limit, Math.round(body.length * 0.65));
      return {
        body: shorten(body, target),
        hashtags,
        callToAction,
        note:
          language === 'FR'
            ? `Raccourci à ${target} caractères environ.`
            : `Shortened to about ${target} characters.`,
      };
    }

    case 'EXPAND':
      return {
        body: clampToLimit(expand(body, language, subject), limit),
        hashtags,
        callToAction,
        note:
          language === 'FR' ? 'Un paragraphe de contexte ajouté.' : 'A context paragraph added.',
      };

    case 'CHANGE_TONE':
      return {
        body: changeTone(body, language, tone),
        hashtags,
        callToAction,
        note: language === 'FR' ? 'Ton réajusté.' : 'Tone adjusted.',
      };

    case 'ADD_CTA': {
      const next = addCallToAction(body, callToAction, platform, language);
      return {
        body: next.body,
        hashtags,
        callToAction: next.callToAction,
        note: language === 'FR' ? 'Appel à l’action ajouté.' : 'Call to action added.',
      };
    }

    case 'HASHTAGS': {
      const next = proposeHashtags(body, subject, language, platform);
      return {
        body,
        hashtags: next,
        callToAction,
        note:
          language === 'FR'
            ? `${next.length} hashtag(s) proposé(s), dans la limite de la plateforme.`
            : `${next.length} hashtag(s) proposed, within the platform limit.`,
      };
    }

    case 'TRANSLATE': {
      // La traduction est une régénération dans l'autre langue : le texte source
      // étant produit par nos soins, on sait le reconstruire fidèlement.
      const target: ContentLanguage = language === 'FR' ? 'EN' : 'FR';
      return {
        body,
        hashtags,
        callToAction,
        note:
          target === 'EN'
            ? 'Traduction indisponible hors ligne : utilisez « Régénérer » avec la langue EN.'
            : 'Traduction indisponible hors ligne : utilisez « Régénérer » avec la langue FR.',
      };
    }

    case 'VARIATIONS': {
      const options = variations(body, language, tone);
      return {
        body: options[0] ?? body,
        hashtags,
        callToAction,
        note:
          language === 'FR'
            ? `${options.length} variantes d’ouverture générées.`
            : `${options.length} opening variations generated.`,
      };
    }

    default:
      return { body, hashtags, callToAction, note: '' };
  }
}

/** Expose les variantes d'ouverture pour l'interface. */
export function previewVariations(
  body: string,
  language: ContentLanguage,
  tone: ContentTone,
): string[] {
  return variations(body, language, tone);
}
