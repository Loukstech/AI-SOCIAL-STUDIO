import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  contentLanguageSchema,
  contentToneSchema,
  contentTypeSchema,
  platformSpecs,
  socialPlatformSchema,
  type ContentLanguage,
  type ContentProject,
  type ContentProjectDetail,
  type ContentTone,
  type ContentType,
  type ContentVariant,
  type GenerateContentInput,
  type RewriteVariantInput,
  type SocialPlatform,
  type UpdateVariantInput,
} from '@ass/shared';
import { Db } from '../common/validation.js';
import { ENV, type Env } from '../config/env.js';
import { applyAction } from './assistant.js';
import { analyseBrief, generateVariant, type Brief } from './content-generator.js';

/**
 * Orchestration du AI Content Studio.
 *
 * Le fournisseur reste `mock` : la génération est déterministe et locale. Un
 * modèle de langage réel se brancherait ici, en conservant les mêmes contrats.
 */
@Injectable()
export class ContentService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async generate(
    organizationId: string,
    input: GenerateContentInput,
    brandName: string | null,
  ): Promise<ContentProjectDetail> {
    if (this.env.AI_PROVIDER !== 'mock') {
      throw new ServiceUnavailableException(
        `Fournisseur IA « ${this.env.AI_PROVIDER} » non disponible : seule la génération locale (AI_PROVIDER=mock) est active.`,
      );
    }

    const analysis = analyseBrief(input.brief);
    const brief: Brief = {
      brief: input.brief,
      subject: analysis.subject,
      objective: input.objective ?? analysis.objective,
      audience: input.audience ?? analysis.audience,
      tone: input.tone,
      contentType: input.contentType,
      language: input.language,
      brandName,
    };

    const project = await this.db.client.contentProject.create({
      data: {
        organizationId,
        ...(input.brandId ? { brandId: input.brandId } : {}),
        brief: input.brief,
        subject: brief.subject,
        objective: brief.objective,
        audience: brief.audience,
        tone: brief.tone,
        contentType: brief.contentType,
        language: brief.language,
        provider: 'mock',
      },
    });

    const variants = input.platforms.map((platform) => generateVariant(brief, platform));
    await this.db.client.contentVariant.createMany({
      data: variants.map((variant) => ({
        projectId: project.id,
        platform: variant.platform,
        language: brief.language,
        title: variant.title,
        body: variant.body,
        hashtags: variant.hashtags,
        callToAction: variant.callToAction,
        charCount: variant.charCount,
        warnings: variant.warnings,
      })),
    });

    return this.detail(organizationId, project.id);
  }

  async list(organizationId: string): Promise<ContentProject[]> {
    const rows = await this.db.client.contentProject.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { _count: { select: { variants: true } } },
    });
    return rows.map((row) => toProject(row, row._count.variants));
  }

  async detail(organizationId: string, id: string): Promise<ContentProjectDetail> {
    const row = await this.db.client.contentProject.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        variants: { orderBy: [{ platform: 'asc' }, { language: 'asc' }] },
        _count: { select: { variants: true } },
      },
    });
    if (!row) throw new NotFoundException('Projet de contenu introuvable');
    return {
      ...toProject(row, row._count.variants),
      variants: row.variants.map(toVariant),
    };
  }

  async updateVariant(
    organizationId: string,
    projectId: string,
    variantId: string,
    input: UpdateVariantInput,
  ): Promise<ContentProjectDetail> {
    const project = await this.findProject(organizationId, projectId);
    const variant = await this.db.client.contentVariant.findFirst({
      where: { id: variantId, projectId: project.id },
    });
    if (!variant) throw new NotFoundException('Variante introuvable');

    const platform = socialPlatformSchema.parse(variant.platform);
    const spec = platformSpecs[platform];
    const body = input.body ?? variant.body;
    const hashtags = input.hashtags ?? variant.hashtags;
    const title = input.title === undefined ? variant.title : input.title;
    const callToAction =
      input.callToAction === undefined ? variant.callToAction : input.callToAction;

    if (hashtags.length > spec.maxHashtags) {
      throw new BadRequestException(
        `${spec.label} accepte au maximum ${spec.maxHashtags} hashtags (${hashtags.length} fournis)`,
      );
    }

    const { charCount, warnings } = measure(body, hashtags, platform, variant.language);

    await this.db.client.contentVariant.update({
      where: { id: variant.id },
      data: {
        body,
        hashtags,
        title,
        callToAction,
        charCount,
        warnings,
        edited: true,
      },
    });
    return this.detail(organizationId, project.id);
  }

  async rewrite(
    organizationId: string,
    projectId: string,
    variantId: string,
    input: RewriteVariantInput,
  ): Promise<ContentProjectDetail> {
    const project = await this.findProject(organizationId, projectId);
    const variant = await this.db.client.contentVariant.findFirst({
      where: { id: variantId, projectId: project.id },
    });
    if (!variant) throw new NotFoundException('Variante introuvable');

    const platform = socialPlatformSchema.parse(variant.platform);
    const language = contentLanguageSchema.parse(variant.language);
    const tone = input.tone ?? contentToneSchema.parse(project.tone);

    // La traduction régénère la variante dans l'autre langue : c'est la seule
    // action qui ne peut pas être une réécriture du texte existant.
    if (input.action === 'TRANSLATE') {
      const target = input.language ?? (language === 'FR' ? 'EN' : 'FR');
      if (target === language) {
        throw new BadRequestException('La variante est déjà dans cette langue');
      }
      const brief = briefOf(project);
      const draft = generateVariant({ ...brief, language: target }, platform);
      await this.db.client.contentVariant.upsert({
        where: {
          projectId_platform_language: {
            projectId: project.id,
            platform,
            language: target,
          },
        },
        create: {
          projectId: project.id,
          platform,
          language: target,
          title: draft.title,
          body: draft.body,
          hashtags: draft.hashtags,
          callToAction: draft.callToAction,
          charCount: draft.charCount,
          warnings: draft.warnings,
        },
        update: {
          title: draft.title,
          body: draft.body,
          hashtags: draft.hashtags,
          callToAction: draft.callToAction,
          charCount: draft.charCount,
          warnings: draft.warnings,
        },
      });
      return this.detail(organizationId, project.id);
    }

    const result = applyAction(input.action, {
      body: variant.body,
      hashtags: variant.hashtags,
      callToAction: variant.callToAction,
      platform,
      language,
      tone,
      subject: project.subject ?? project.brief.slice(0, 120),
    });

    const { charCount, warnings } = measure(result.body, result.hashtags, platform, language);

    await this.db.client.contentVariant.update({
      where: { id: variant.id },
      data: {
        body: result.body,
        hashtags: result.hashtags,
        callToAction: result.callToAction,
        charCount,
        warnings,
        edited: true,
      },
    });
    return this.detail(organizationId, project.id);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    const project = await this.findProject(organizationId, id);
    await this.db.client.contentProject.update({
      where: { id: project.id },
      data: { deletedAt: new Date() },
    });
  }

  /** Contexte projet nécessaire aux contrôleurs (audit, permissions). */
  async findProject(
    organizationId: string,
    id: string,
  ): Promise<{
    id: string;
    brief: string;
    subject: string | null;
    objective: string | null;
    audience: string | null;
    tone: string;
    contentType: string;
    language: string;
    brandId: string | null;
  }> {
    const project = await this.db.client.contentProject.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!project) throw new NotFoundException('Projet de contenu introuvable');
    return project;
  }
}

/** Recalcule la longueur et les écarts aux règles de la plateforme. */
export function measure(
  body: string,
  hashtags: string[],
  platform: SocialPlatform,
  language: string,
): { charCount: number; warnings: string[] } {
  const spec = platformSpecs[platform];
  const block = hashtags.length > 0 ? `\n\n${hashtags.join(' ')}` : '';
  const charCount = (body + block).length;
  const warnings: string[] = [];
  const fr = language === 'FR';

  if (charCount > spec.maxChars) {
    warnings.push(
      fr
        ? `Dépasse la limite de ${spec.maxChars} caractères imposée par ${spec.label}.`
        : `Exceeds ${spec.label}'s ${spec.maxChars}-character limit.`,
    );
  } else if (charCount > spec.recommendedChars) {
    warnings.push(
      fr
        ? `Plus long que la longueur recommandée (${spec.recommendedChars} caractères) pour ${spec.label}.`
        : `Longer than the recommended ${spec.recommendedChars} characters for ${spec.label}.`,
    );
  }
  if (spec.titleMaxChars !== undefined && !body.trim()) {
    warnings.push(fr ? 'Texte vide.' : 'Empty text.');
  }
  return { charCount, warnings };
}

function briefOf(project: {
  brief: string;
  subject: string | null;
  objective: string | null;
  audience: string | null;
  tone: string;
  contentType: string;
  language: string;
}): Brief {
  return {
    brief: project.brief,
    subject: project.subject ?? project.brief.slice(0, 120),
    objective: project.objective,
    audience: project.audience,
    tone: contentToneSchema.parse(project.tone) as ContentTone,
    contentType: contentTypeSchema.parse(project.contentType) as ContentType,
    language: contentLanguageSchema.parse(project.language) as ContentLanguage,
    brandName: null,
  };
}

export function toVariant(row: {
  id: string;
  projectId: string;
  platform: string;
  language: string;
  title: string | null;
  body: string;
  hashtags: string[];
  callToAction: string | null;
  charCount: number;
  warnings: string[];
  edited: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ContentVariant {
  return {
    id: row.id,
    projectId: row.projectId,
    platform: socialPlatformSchema.parse(row.platform),
    language: contentLanguageSchema.parse(row.language),
    title: row.title,
    body: row.body,
    hashtags: row.hashtags,
    callToAction: row.callToAction,
    charCount: row.charCount,
    warnings: row.warnings,
    edited: row.edited,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toProject(
  row: {
    id: string;
    organizationId: string;
    brandId: string | null;
    brief: string;
    subject: string | null;
    objective: string | null;
    audience: string | null;
    tone: string;
    contentType: string;
    language: string;
    provider: string;
    createdAt: Date;
    updatedAt: Date;
  },
  variantCount: number,
): ContentProject {
  return {
    id: row.id,
    organizationId: row.organizationId,
    brandId: row.brandId,
    brief: row.brief,
    subject: row.subject,
    objective: row.objective,
    audience: row.audience,
    tone: contentToneSchema.parse(row.tone),
    contentType: contentTypeSchema.parse(row.contentType),
    language: contentLanguageSchema.parse(row.language),
    provider: row.provider,
    variantCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
