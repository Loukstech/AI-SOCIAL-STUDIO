import type {
  ContentLanguage,
  ContentTone,
  ContentType,
  PlatformSpec,
  SocialPlatform,
} from '@ass/shared';
import { platformSpecs } from '@ass/shared';

/**
 * Générateur de contenus du AI Content Studio (§6.1 à §6.3).
 *
 * Déterministe et sans appel externe, comme le pipeline vidéo : la frontière
 * fournisseur est explicite. Brancher un modèle de langage consistera à
 * remplacer `generateVariant` par un appel API renvoyant la même structure.
 *
 * Le texte produit n'est pas de la « fausse IA » : c'est un assemblage
 * éditorial explicite (accroche, fond, bénéfice, appel à l'action) calibré sur
 * les règles réelles de chaque plateforme. L'utilisateur édite ensuite.
 */

export interface Brief {
  brief: string;
  subject: string;
  objective: string | null;
  audience: string | null;
  tone: ContentTone;
  contentType: ContentType;
  language: ContentLanguage;
  brandName: string | null;
}

export interface VariantDraft {
  platform: SocialPlatform;
  title: string | null;
  body: string;
  hashtags: string[];
  callToAction: string | null;
  charCount: number;
  warnings: string[];
}

const LEADING_VERBS =
  /^(?:cr[ée]e[rz]?|r[ée]dige[rz]?|[ée]cri[sz]|g[ée]n[èe]re[rz]?|propose[rz]?|pr[ée]pare[rz]?|fai[ts]es?|produi[ts]ez?|annonce[rz]?|lance[rz]?|pr[ée]sente[rz]?|promouvoi[rs]|vends?|vendez)\s+/i;

const OBJECTIVE_BY_VERB: Record<string, string> = {
  cree: 'créer',
  creer: 'créer',
  redige: 'rédiger',
  rediger: 'rédiger',
  ecris: 'rédiger',
  ecrivez: 'rédiger',
  genere: 'générer',
  generer: 'générer',
  propose: 'proposer',
  proposer: 'proposer',
  prepare: 'préparer',
  preparer: 'préparer',
  fais: 'produire',
  faites: 'produire',
  produis: 'produire',
  produisez: 'produire',
  annonce: 'annoncer',
  annoncer: 'annoncer',
  annoncez: 'annoncer',
  lance: 'lancer',
  lancer: 'lancer',
  lancez: 'lancer',
  presente: 'présenter',
  presenter: 'présenter',
  presentez: 'présenter',
  promouvoir: 'promouvoir',
  promouvois: 'promouvoir',
  vends: 'vendre',
  vendez: 'vendre',
};

const PURPOSE =
  /\bpour\s+(annoncer|promouvoir|pr[ée]senter|vendre|recruter|informer|lancer|faire conna[îi]tre|expliquer|partager|sensibiliser|convertir|fid[ée]liser|inviter)\b\s*(.+)$/i;

const INSTRUCTION_CUT =
  /\b(?:le ton|la cible|le public|l'objectif|pense[rz]? à|n'oublie[rz]? pas|ajoute[rz]?|utilise[rz]?|encourage[rz]?|dans le but|afin de|il faut)\b/i;

const AUDIENCE_NOUNS =
  /(d[ée]butants?|professionnels?|professionnelles?|experts?|entrepreneurs?|entrepreneuses?|[ée]tudiants?|[ée]tudiantes?|clients?|prospects?|managers?|cr[ée]ateurs?|cr[ée]atrices?|formateurs?|ind[ée]pendants?|d[ée]cideurs?|recruteurs?)/i;

/** Retire les déterminants de tête pour isoler le sujet. */
function stripDeterminers(value: string): string {
  return value
    .replace(
      /^(?:notre|nos|votre|vos|leur|leurs|le|la|les|l['’]|un|une|des|du|de la|de l['’])\s*/i,
      '',
    )
    .replace(/[.;:!?]+$/, '')
    .trim();
}

function normaliseKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Extrait sujet, objectif et public d'un brief en langage naturel (§6.1). */
export function analyseBrief(brief: string): {
  subject: string;
  objective: string | null;
  audience: string | null;
} {
  const text = brief.replace(/\s+/g, ' ').trim();

  // 1. Verbe d'action initial → objectif implicite.
  const verbMatch = text.match(LEADING_VERBS);
  let objective = verbMatch ? (OBJECTIVE_BY_VERB[normaliseKey(verbMatch[0].trim())] ?? null) : null;
  let rest = verbMatch ? text.slice(verbMatch[0].length) : text;

  // 2. On ne garde que la première phrase : la suite est une consigne.
  rest = rest.split(/(?<=[.!?…])\s+/u)[0] ?? rest;

  // 3. Coupe sur les marqueurs de consigne (« le ton doit être… »).
  const cut = rest.search(INSTRUCTION_CUT);
  if (cut > 0) rest = rest.slice(0, cut);

  // 4. « … pour annoncer X » : l'objectif est explicite, X devient le sujet.
  const purpose = rest.match(PURPOSE);
  if (purpose) {
    objective = purpose[1]!.toLowerCase();
    rest = purpose[2]!.trim();
  }

  const subject = stripDeterminers(rest) || text.slice(0, 120);
  const audienceMatch = brief.match(AUDIENCE_NOUNS);

  return {
    subject,
    objective,
    audience: audienceMatch ? audienceMatch[1]!.toLowerCase() : null,
  };
}

/* ------------------------------------------------------------------ */
/* Lexiques                                                           */
/* ------------------------------------------------------------------ */

interface ToneLexicon {
  hooks: string[];
  bridges: string[];
  closers: string[];
}

const TONES: Record<ContentLanguage, Record<ContentTone, ToneLexicon>> = {
  FR: {
    PROFESSIONAL: {
      hooks: ['À retenir.', 'Point d’étape.', 'Une actualité à partager.'],
      bridges: ['Concrètement,', 'En pratique,', 'Sur le terrain,'],
      closers: [
        'Nous restons disponibles pour en discuter.',
        'Les détails sont disponibles sur demande.',
      ],
    },
    DYNAMIC: {
      hooks: ['Ça avance vite.', 'Nouveauté de la semaine.', 'On ne ralentit pas.'],
      bridges: ['Le résultat ?', 'Et ce n’est pas tout :', 'Concrètement :'],
      closers: ['On vous embarque ?', 'La suite arrive très vite.'],
    },
    FRIENDLY: {
      hooks: ['Bonne nouvelle.', 'On a quelque chose à vous dire.', 'Petite annonce du jour.'],
      bridges: ['Et franchement,', 'Le mieux, c’est que', 'Côté pratique,'],
      closers: ['On avait hâte de vous le partager.', 'Dites-nous ce que vous en pensez.'],
    },
    EXPERT: {
      hooks: ['Ce qu’il faut savoir.', 'Décryptage.', 'Le point technique.'],
      bridges: ['Le mécanisme est simple :', 'Ce qui change vraiment :', 'En analyse,'],
      closers: ['Le sujet mérite d’être creusé.', 'Les chiffres parlent d’eux-mêmes.'],
    },
    INSPIRING: {
      hooks: [
        'Et si on voyait plus loin ?',
        'Il y a des sujets qui comptent.',
        'Une idée pour demain.',
      ],
      bridges: ['Parce que', 'C’est là que tout se joue :', 'Le déclic, souvent, c’est'],
      closers: ['Le meilleur moment pour commencer, c’est maintenant.', 'À vous de jouer.'],
    },
    PLAYFUL: {
      hooks: ['Alerte info.', 'On ne va pas se mentir.', 'Bon, on vous dit tout.'],
      bridges: ['Le bonus ?', 'Et le meilleur dans tout ça ?', 'Spoiler :'],
      closers: ['Voilà, c’était dit.', 'Vous reprendrez bien un peu de nouveauté ?'],
    },
  },
  EN: {
    PROFESSIONAL: {
      hooks: ['Worth noting.', 'A quick update.', 'News to share.'],
      bridges: ['In practice,', 'Concretely,', 'On the ground,'],
      closers: ['Happy to discuss further.', 'Details available on request.'],
    },
    DYNAMIC: {
      hooks: ['Moving fast.', 'New this week.', 'No slowdown here.'],
      bridges: ['The result?', 'And there is more:', 'Concretely:'],
      closers: ['Coming with us?', 'More very soon.'],
    },
    FRIENDLY: {
      hooks: ['Good news.', 'Something we wanted to share.', 'Today’s little announcement.'],
      bridges: ['And honestly,', 'The best part is', 'Practically speaking,'],
      closers: ['We could not wait to tell you.', 'Let us know what you think.'],
    },
    EXPERT: {
      hooks: ['What you need to know.', 'Breaking it down.', 'The technical point.'],
      bridges: ['The mechanism is simple:', 'What really changes:', 'Looking closely,'],
      closers: ['This deserves a deeper look.', 'The numbers speak for themselves.'],
    },
    INSPIRING: {
      hooks: ['What if we looked further?', 'Some topics matter.', 'An idea for tomorrow.'],
      bridges: ['Because', 'That is where it all happens:', 'The turning point is often'],
      closers: ['The best time to start is now.', 'Your move.'],
    },
    PLAYFUL: {
      hooks: ['Heads up.', 'Let us be honest.', 'Okay, full disclosure.'],
      bridges: ['The bonus?', 'And the best part?', 'Spoiler:'],
      closers: ['There, we said it.', 'Care for a little novelty?'],
    },
  },
};

const CTA: Record<ContentLanguage, Record<SocialPlatform, string>> = {
  FR: {
    FACEBOOK: 'Dites-nous en commentaire ce que vous en pensez.',
    INSTAGRAM: 'Enregistrez cette publication pour la retrouver plus tard.',
    LINKEDIN: 'Et vous, comment abordez-vous le sujet ?',
    TIKTOK: 'Suivez-nous pour la suite.',
    YOUTUBE: 'Abonnez-vous pour ne rien manquer des prochaines vidéos.',
    X: 'Votre avis ?',
    PINTEREST: 'Épinglez cette idée pour la garder sous la main.',
    THREADS: 'On en parle en commentaire ?',
  },
  EN: {
    FACEBOOK: 'Tell us what you think in the comments.',
    INSTAGRAM: 'Save this post for later.',
    LINKEDIN: 'How do you approach this?',
    TIKTOK: 'Follow us for more.',
    YOUTUBE: 'Subscribe so you do not miss the next ones.',
    X: 'Thoughts?',
    PINTEREST: 'Pin this idea for later.',
    THREADS: 'Let us talk about it below?',
  },
};

/** Formulation du fond, par type de contenu (§6.2). */
const CORE: Record<
  ContentLanguage,
  Record<ContentType, (subject: string, audience: string) => string>
> = {
  FR: {
    PROMO: (s, a) => `${s} : une offre pensée pour ${a}.`,
    ANNOUNCEMENT: (s) => `Nous avons une annonce à partager : ${s}.`,
    PROMOTION: (s) => `${s}, à conditions préférentielles pour une durée limitée.`,
    COMPANY_INTRO: (s) => `${s} : notre façon de travailler, nos valeurs et ce qui nous anime.`,
    QUOTE: (s) => `« ${s} » — une conviction qui guide nos décisions.`,
    TIP: (s) => `Une astuce simple sur ${s}, applicable dès aujourd’hui.`,
    TUTORIAL: (s) => `${s}, expliqué étape par étape.`,
    TESTIMONIAL: (s) => `Ce que nos clients disent de ${s}.`,
    PRODUCT_LAUNCH: (s) => `${s} est disponible à partir d’aujourd’hui.`,
    EVENT: (s) => `${s} : rendez-vous à noter dès maintenant dans votre agenda.`,
    SPECIAL_OFFER: (s) => `${s}, avec un avantage réservé à cette période.`,
    EDUCATIONAL: (s) => `Comprendre ${s} en quelques lignes.`,
    VIDEO_SCRIPT: (s) => `Script vidéo autour de ${s}.`,
    CAROUSEL: (s) => `Un carrousel pour faire le tour de ${s}.`,
  },
  EN: {
    PROMO: (s, a) => `${s}: built for ${a}.`,
    ANNOUNCEMENT: (s) => `We have news to share: ${s}.`,
    PROMOTION: (s) => `${s}, on preferential terms for a limited time.`,
    COMPANY_INTRO: (s) => `${s}: how we work, what we value and what drives us.`,
    QUOTE: (s) => `“${s}” — a belief that guides our decisions.`,
    TIP: (s) => `A simple tip about ${s}, usable today.`,
    TUTORIAL: (s) => `${s}, explained step by step.`,
    TESTIMONIAL: (s) => `What our clients say about ${s}.`,
    PRODUCT_LAUNCH: (s) => `${s} is available starting today.`,
    EVENT: (s) => `${s}: save the date now.`,
    SPECIAL_OFFER: (s) => `${s}, with an advantage reserved for this period.`,
    EDUCATIONAL: (s) => `Understanding ${s} in a few lines.`,
    VIDEO_SCRIPT: (s) => `Video script about ${s}.`,
    CAROUSEL: (s) => `A carousel to cover ${s}.`,
  },
};

const BENEFIT: Record<ContentLanguage, Record<ContentType, string[]>> = {
  FR: {
    PROMO: ['Un accompagnement clair, du premier échange à la mise en œuvre.'],
    ANNOUNCEMENT: ['Toutes les informations pratiques sont disponibles dès maintenant.'],
    PROMOTION: ['Les conditions sont valables jusqu’à la fin de la période annoncée.'],
    COMPANY_INTRO: ['Une équipe resserrée, des interlocuteurs stables, des décisions rapides.'],
    QUOTE: ['Une phrase courte qui résume une exigence de tous les instants.'],
    TIP: ['Testez sur un seul cas avant de généraliser : vous verrez l’écart tout de suite.'],
    TUTORIAL: ['Chaque étape tient en une action concrète, sans prérequis technique.'],
    TESTIMONIAL: ['Un retour obtenu après plusieurs mois d’utilisation réelle.'],
    PRODUCT_LAUNCH: ['Les premiers retours confirment le gain de temps annoncé.'],
    EVENT: ['Le programme complet sera publié dans les prochains jours.'],
    SPECIAL_OFFER: ['Aucune condition cachée : l’avantage s’applique automatiquement.'],
    EDUCATIONAL: ['Le principe reste le même quel que soit votre niveau de départ.'],
    VIDEO_SCRIPT: ['Format court, une idée par plan, un appel à l’action final.'],
    CAROUSEL: ['Chaque carte porte une seule idée, pour rester lisible sur mobile.'],
  },
  EN: {
    PROMO: ['Clear guidance, from the first conversation to delivery.'],
    ANNOUNCEMENT: ['All practical details are available right now.'],
    PROMOTION: ['Terms apply until the end of the announced period.'],
    COMPANY_INTRO: ['A tight team, stable contacts, fast decisions.'],
    QUOTE: ['A short line that sums up a constant standard.'],
    TIP: ['Try it on a single case before scaling: the gap shows up immediately.'],
    TUTORIAL: ['Every step is one concrete action, with no technical prerequisite.'],
    TESTIMONIAL: ['Feedback gathered after several months of real use.'],
    PRODUCT_LAUNCH: ['Early feedback confirms the announced time savings.'],
    EVENT: ['The full programme will be published in the coming days.'],
    SPECIAL_OFFER: ['No hidden conditions: the advantage applies automatically.'],
    EDUCATIONAL: ['The principle stays the same whatever your starting point.'],
    VIDEO_SCRIPT: ['Short format, one idea per shot, one closing call to action.'],
    CAROUSEL: ['Each card carries a single idea, so it stays readable on mobile.'],
  },
};

/** Petite fonction de hachage : même entrée, même sortie, sans aléatoire. */
function seedOf(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 100_000;
  }
  return hash;
}

function pick<T>(items: T[], seed: number, offset = 0): T {
  return items[(seed + offset) % items.length]!;
}

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
  'nouvelle',
  'nouveau',
  'lancement',
  'annonce',
  'publication',
  'contenu',
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

/** Hashtags dérivés du sujet, dédupliqués et normalisés. */
export function buildHashtags(subject: string, language: ContentLanguage, limit: number): string[] {
  const words = subject
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word.toLowerCase()));

  const tags = words.map((word) => `#${word.charAt(0).toUpperCase()}${word.slice(1)}`);
  const generic =
    language === 'FR' ? ['#Communication', '#RéseauxSociaux'] : ['#Marketing', '#SocialMedia'];
  const unique = [...new Set([...tags, ...generic])];
  return unique.slice(0, limit);
}

/** Tronque proprement à la limite de la plateforme. */
export function clampToLimit(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const boundary = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return `${cut.slice(0, boundary > limit * 0.6 ? boundary : limit - 1).trimEnd()}…`;
}

function paragraphs(parts: string[], platform: SocialPlatform): string {
  switch (platform) {
    case 'X':
    case 'TIKTOK':
    case 'THREADS':
      return parts.join(' ');
    default:
      return parts.join('\n\n');
  }
}

/** Compose une variante éditoriale pour une plateforme. */
export function generateVariant(brief: Brief, platform: SocialPlatform): VariantDraft {
  const spec: PlatformSpec = platformSpecs[platform];
  const lang = brief.language;
  const seed = seedOf(`${brief.subject}|${platform}|${brief.tone}|${brief.contentType}`);
  const lexicon = TONES[lang][brief.tone];
  const audience = brief.audience ?? (lang === 'FR' ? 'vous' : 'you');

  const hook = pick(lexicon.hooks, seed);
  const core = CORE[lang][brief.contentType](brief.subject, audience);
  const benefit = pick(BENEFIT[lang][brief.contentType], seed, 1);
  const closer = pick(lexicon.closers, seed, 2);
  const cta = CTA[lang][platform];

  const title =
    spec.titleMaxChars !== undefined
      ? clampToLimit(
          `${brief.subject.charAt(0).toUpperCase()}${brief.subject.slice(1)}`,
          spec.titleMaxChars,
        )
      : null;

  // Les plateformes courtes enchaînent tout sur un seul bloc ; les autres
  // respirent avec un paragraphe par intention éditoriale.
  let body: string;
  switch (platform) {
    case 'X':
      body = paragraphs([core, cta], platform);
      break;
    case 'TIKTOK':
    case 'THREADS':
      body = paragraphs([hook, core, cta], platform);
      break;
    case 'LINKEDIN':
    case 'FACEBOOK':
      // Pas de formule de politesse ici : elle ferait doublon avec l'appel à l'action.
      body = paragraphs([hook, core, benefit, cta], platform);
      break;
    case 'YOUTUBE':
      body = paragraphs([hook, core, benefit, closer, cta], platform);
      break;
    case 'INSTAGRAM':
    case 'PINTEREST':
    default:
      body = paragraphs([hook, core, benefit, cta], platform);
  }

  if (brief.brandName) {
    body = `${body}\n\n— ${brief.brandName}`;
  }

  const hashtags = buildHashtags(brief.subject, lang, spec.maxHashtags);
  const warnings: string[] = [];

  // Les hashtags font partie du texte publiable : ils comptent dans la limite.
  const hashtagBlock = hashtags.length > 0 ? `\n\n${hashtags.join(' ')}` : '';
  let finalBody = body;
  let charCount = (finalBody + hashtagBlock).length;

  if (charCount > spec.maxChars) {
    // On réserve la place des hashtags, avec un plancher pour ne pas tout écraser.
    const budget = Math.max(80, spec.maxChars - hashtagBlock.length);
    finalBody = clampToLimit(body, budget);
    charCount = (finalBody + hashtagBlock).length;
    warnings.push(
      lang === 'FR'
        ? `Texte ramené à la limite de ${spec.maxChars} caractères imposée par ${spec.label}.`
        : `Text trimmed to ${spec.label}'s ${spec.maxChars}-character limit.`,
    );
  } else if (charCount > spec.recommendedChars) {
    warnings.push(
      lang === 'FR'
        ? `Plus long que la longueur recommandée (${spec.recommendedChars} caractères) pour ${spec.label}.`
        : `Longer than the recommended ${spec.recommendedChars} characters for ${spec.label}.`,
    );
  }

  return {
    platform,
    title,
    body: finalBody,
    hashtags,
    callToAction: cta,
    charCount,
    warnings,
  };
}

/** Génère une variante par plateforme sélectionnée (§6.3). */
export function generateVariants(brief: Brief, platforms: SocialPlatform[]): VariantDraft[] {
  return platforms.map((platform) => generateVariant(brief, platform));
}
