import {
  composePublicationText,
  platformCapabilities,
  platformSpecs,
  supportsPostType,
  type PostType,
  type SocialPlatform,
} from '@ass/shared';

/**
 * Contrôle d'une cible avant publication (§9.4 `validatePost`, §10.4).
 *
 * Les erreurs bloquent l'envoi ; les avertissements sont affichés mais laissent
 * l'auteur décider. Aucune règle n'est devinée : les limites viennent de
 * `platformSpecs` (Phase 5) et les formats de `platformCapabilities`.
 */

export interface TargetCheck {
  /** Longueur du texte réellement publié, hashtags compris. */
  charCount: number;
  charLimit: number;
  warnings: string[];
  errors: string[];
}

export interface TargetInput {
  platform: SocialPlatform;
  postType: PostType;
  body: string;
  title?: string | null | undefined;
  hashtags?: string[] | undefined;
  mediaCount?: number | undefined;
}

export function checkTarget(input: TargetInput): TargetCheck {
  const { platform, postType, body, title, hashtags = [], mediaCount = 0 } = input;
  const spec = platformSpecs[platform];
  const capability = platformCapabilities[platform];
  const text = composePublicationText(body, hashtags);
  const charCount = text.length;
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!supportsPostType(platform, postType)) {
    const accepted = capability.supports.join(', ');
    errors.push(`${spec.label} n’accepte pas le format ${postType} (formats : ${accepted})`);
  }

  if (charCount > spec.maxChars) {
    errors.push(
      `Texte trop long pour ${spec.label} : ${charCount} caractères sur ${spec.maxChars} autorisés`,
    );
  } else if (charCount > spec.recommendedChars) {
    warnings.push(
      `Au-delà de ${spec.recommendedChars} caractères, l’engagement baisse sur ${spec.label}`,
    );
  }

  if (hashtags.length > spec.maxHashtags) {
    warnings.push(
      `${hashtags.length} hashtags pour ${spec.maxHashtags} conseillés sur ${spec.label}`,
    );
  }

  if (capability.requiresMedia.includes(postType) && mediaCount === 0) {
    errors.push(`${spec.label} exige au moins un média pour le format ${postType}`);
  }

  if (mediaCount > capability.maxMedia) {
    errors.push(`${mediaCount} médias pour ${capability.maxMedia} autorisés sur ${spec.label}`);
  }

  if (title && spec.titleMaxChars && title.length > spec.titleMaxChars) {
    errors.push(
      `Titre trop long pour ${spec.label} : ${title.length} caractères sur ${spec.titleMaxChars}`,
    );
  }

  if (title && !spec.titleMaxChars) {
    warnings.push(`${spec.label} n’affiche pas de titre séparé : il sera ignoré`);
  }

  if (postType === 'LINK' && !/https?:\/\//u.test(text)) {
    errors.push('Format lien sans URL dans le texte');
  }

  if (charCount === 0) {
    errors.push('Texte vide');
  }

  return { charCount, charLimit: spec.maxChars, warnings, errors };
}

/** Vérifie qu'un même format est possible sur toutes les cibles visées. */
export function checkPublication(
  postType: PostType,
  targets: Array<Omit<TargetInput, 'postType'>>,
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const target of targets) {
    const check = checkTarget({ ...target, postType });
    const prefix = platformSpecs[target.platform].label;
    errors.push(...check.errors.map((message) => `${prefix} : ${message}`));
    warnings.push(...check.warnings.map((message) => `${prefix} : ${message}`));
  }
  return { ok: errors.length === 0, errors, warnings };
}
