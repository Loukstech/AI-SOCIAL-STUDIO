import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  brandPalette,
  checkPlatformFormat,
  imageFormatSchema,
  imageStyleSchema,
  planDecline,
  resolveDimensions,
  socialPlatformSchema,
  type Brand,
  type CreateImageProjectInput,
  type DeclineImageProjectInput,
  type DeclineResult,
  type ImageFormat,
  type ImageProject,
  type ImageProjectDetail,
  type ImageStyle,
  type SocialPlatform,
  type UpdateImageProjectInput,
} from '@ass/shared';
import { Db } from '../common/validation.js';
import { composeImage } from './composer.js';

/**
 * AI Image Studio (§7).
 *
 * Chaque visuel conserve son prompt, son moteur, sa version, sa graine et la
 * palette appliquée : la génération est reproductible et auditable. Les textes
 * sont stockés comme calques séparés, donc corrigeables sans régénérer.
 */

interface ImageRow {
  id: string;
  organizationId: string;
  brandId: string | null;
  sourceProjectId: string | null;
  title: string | null;
  prompt: string;
  format: string;
  width: number;
  height: number;
  style: string;
  provider: string;
  model: string;
  seed: number;
  platform: string | null;
  palette: string[];
  logoMediaId: string | null;
  referenceMediaIds: string[];
  headline: string | null;
  subheadline: string | null;
  callToAction: string | null;
  badge: string | null;
  svg: string;
  warnings: string[];
  createdAt: Date;
  updatedAt: Date;
}

const PROVIDER = 'svg';
const MODEL = 'layout-v1';

/** Retire le verbe d'instruction pour ne garder que le sujet du visuel. */
export function deriveHeadline(prompt: string): string {
  const cleaned = prompt
    .replace(
      /^\s*(cr[ée]e|g[ée]n[èe]re|fais|r[ée]alise|con[çc]ois|imagine|dessine|produis)\b\s*/iu,
      '',
    )
    .trim();
  const firstSentence = cleaned.split(/(?<=[.!?…])\s+/u)[0] ?? cleaned;
  const value = (firstSentence || prompt).replace(/[.!…]+$/u, '').trim();
  if (value.length <= 70) return value;
  return `${value.slice(0, 69).trimEnd()}…`;
}

@Injectable()
export class ImageService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async create(
    organizationId: string,
    actorId: string,
    input: CreateImageProjectInput,
  ): Promise<ImageProjectDetail> {
    const format: ImageFormat = input.format ?? 'SQUARE';
    const style: ImageStyle = input.style ?? 'EDITORIAL';
    const { width, height } = resolveDimensions(format, input.width, input.height);
    const seed = input.seed ?? randomSeed();

    const brand = input.brandId ? await this.brand(organizationId, input.brandId) : null;
    const palette = input.palette ?? (brand ? brandPalette(brand) : []);
    const headline = input.headline ?? deriveHeadline(input.prompt);

    const rendered = await this.render({
      organizationId,
      format,
      style,
      width,
      height,
      palette,
      headline,
      subheadline: input.subheadline ?? null,
      callToAction: input.callToAction ?? null,
      badge: input.badge ?? null,
      logoMediaId: input.logoMediaId ?? brand?.logoPrimaryId ?? null,
      referenceImageIds: input.referenceMediaIds ?? [],
      brandId: input.brandId ?? null,
      platform: input.platform ?? null,
      seed,
      brand,
    });

    const created = await this.db.client.imageProject.create({
      data: {
        organizationId,
        createdById: actorId,
        prompt: input.prompt,
        format,
        width,
        height,
        style,
        provider: PROVIDER,
        model: MODEL,
        seed,
        palette: rendered.palette,
        logoMediaId: rendered.logoMediaId,
        referenceMediaIds: rendered.referenceImageIds,
        headline: rendered.headline,
        subheadline: rendered.subheadline,
        callToAction: rendered.callToAction,
        badge: rendered.badge,
        svg: rendered.svg,
        warnings: rendered.warnings,
        ...(input.title ? { title: input.title } : {}),
        ...(input.brandId ? { brandId: input.brandId } : {}),
        ...(input.platform ? { platform: input.platform } : {}),
      },
    });

    await this.audit(organizationId, actorId, 'image.created', created.id, {
      format,
      style,
      platform: input.platform ?? 'none',
    });
    return this.toDetail(created as unknown as ImageRow);
  }

  async list(organizationId: string): Promise<ImageProject[]> {
    const rows = await this.db.client.imageProject.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => this.toProject(row as unknown as ImageRow));
  }

  async detail(organizationId: string, id: string): Promise<ImageProjectDetail> {
    const row = await this.find(organizationId, id);
    return this.toDetail(row);
  }

  /** Source SVG brute, pour le téléchargement direct. */
  async svgSource(organizationId: string, id: string): Promise<string> {
    const row = await this.find(organizationId, id);
    return row.svg;
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateImageProjectInput,
  ): Promise<ImageProjectDetail> {
    const row = await this.find(organizationId, id);
    const format: ImageFormat = input.format ?? imageFormatSchema.parse(row.format);
    const style: ImageStyle = input.style ?? imageStyleSchema.parse(row.style);
    const { width, height } = resolveDimensions(
      format,
      input.width ?? row.width,
      input.height ?? row.height,
    );

    const brandId = row.brandId;
    const brand = brandId ? await this.brand(organizationId, brandId) : null;
    const palette = input.palette ?? row.palette;

    const rendered = await this.render({
      organizationId,
      format,
      style,
      width,
      height,
      palette,
      headline: input.headline === undefined ? row.headline : input.headline,
      subheadline: input.subheadline === undefined ? row.subheadline : input.subheadline,
      callToAction: input.callToAction === undefined ? row.callToAction : input.callToAction,
      badge: input.badge === undefined ? row.badge : input.badge,
      logoMediaId: input.logoMediaId === undefined ? row.logoMediaId : input.logoMediaId,
      referenceImageIds: input.referenceMediaIds ?? row.referenceMediaIds,
      brandId,
      platform: input.platform === undefined ? parsePlatform(row.platform) : input.platform,
      seed: input.seed ?? row.seed,
      brand,
    });

    const updated = await this.db.client.imageProject.update({
      where: { id },
      data: {
        format,
        style,
        width,
        height,
        seed: input.seed ?? row.seed,
        palette: rendered.palette,
        logoMediaId: rendered.logoMediaId,
        referenceMediaIds: rendered.referenceImageIds,
        headline: rendered.headline,
        subheadline: rendered.subheadline,
        callToAction: rendered.callToAction,
        badge: rendered.badge,
        svg: rendered.svg,
        warnings: rendered.warnings,
        ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.platform !== undefined ? { platform: input.platform } : {}),
      },
    });

    await this.audit(organizationId, null, 'image.updated', id, null);
    return this.toDetail(updated as unknown as ImageRow);
  }

  /** Nouvelle graine : même contenu, décor différent. */
  async rerender(organizationId: string, id: string, actorId: string): Promise<ImageProjectDetail> {
    return this.update(organizationId, id, { seed: randomSeed() }).then(async (detail) => {
      await this.audit(organizationId, actorId, 'image.rerendered', id, { seed: detail.seed });
      return detail;
    });
  }

  async remove(organizationId: string, id: string, actorId: string): Promise<void> {
    await this.find(organizationId, id);
    await this.db.client.imageProject.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit(organizationId, actorId, 'image.deleted', id, null);
  }

  /**
   * Décline un visuel dans d'autres gabarits (§7).
   *
   * Les calques de texte, la palette, la marque et le style sont repris tels
   * quels ; seul le gabarit change, et le composeur réajuste la typographie.
   * Chaque déclinaison est un visuel à part entière, rattaché à son origine.
   */
  async decline(
    organizationId: string,
    id: string,
    actorId: string,
    input: DeclineImageProjectInput,
  ): Promise<DeclineResult> {
    const source = await this.find(organizationId, id);
    const sourceFormat = imageFormatSchema.parse(source.format);
    const style = imageStyleSchema.parse(source.style);
    const platform = parsePlatform(source.platform);
    const brand = source.brandId ? await this.brand(organizationId, source.brandId) : null;

    const plan = planDecline({ sourceFormat, platform, formats: input.formats });

    const created: ImageProjectDetail[] = [];
    for (const target of plan.targets) {
      const { width, height } = resolveDimensions(target.format);
      const rendered = await this.render({
        organizationId,
        format: target.format,
        style,
        width,
        height,
        palette: source.palette,
        headline: source.headline,
        subheadline: source.subheadline,
        callToAction: source.callToAction,
        badge: source.badge,
        logoMediaId: source.logoMediaId,
        referenceImageIds: source.referenceMediaIds,
        brandId: source.brandId,
        platform: target.platform,
        seed: source.seed,
        brand,
      });

      const row = await this.db.client.imageProject.create({
        data: {
          organizationId,
          createdById: actorId,
          prompt: source.prompt,
          format: target.format,
          width,
          height,
          style,
          provider: source.provider,
          model: source.model,
          seed: source.seed,
          palette: rendered.palette,
          logoMediaId: rendered.logoMediaId,
          referenceMediaIds: rendered.referenceImageIds,
          headline: rendered.headline,
          subheadline: rendered.subheadline,
          callToAction: rendered.callToAction,
          badge: rendered.badge,
          svg: rendered.svg,
          warnings: target.warning ? [...rendered.warnings, target.warning] : rendered.warnings,
          sourceProjectId: source.id,
          ...(source.title ? { title: source.title } : {}),
          ...(source.brandId ? { brandId: source.brandId } : {}),
          ...(target.platform ? { platform: target.platform } : {}),
        },
      });
      created.push(this.toDetail(row as unknown as ImageRow));
    }

    await this.audit(organizationId, actorId, 'image.declined', source.id, {
      created: created.length,
      skipped: plan.skipped.length,
    });

    return { created, skipped: plan.skipped };
  }

  // --- Rendu ---

  private async render(input: {
    organizationId: string;
    format: ImageFormat;
    style: ImageStyle;
    width: number;
    height: number;
    palette: string[];
    headline: string | null;
    subheadline: string | null;
    callToAction: string | null;
    badge: string | null;
    logoMediaId: string | null;
    referenceImageIds: string[];
    brandId: string | null;
    platform: SocialPlatform | null;
    seed: number;
    brand: Brand | null;
  }) {
    const warnings: string[] = [];

    // §8 : un Brand Kit ne doit pas imposer un visuel incompatible avec la
    // plateforme visée. Le refus est explicite plutôt qu'un rendu inutilisable.
    if (input.platform) {
      const problem = checkPlatformFormat(input.platform, input.format, input.width, input.height);
      if (problem) throw new BadRequestException(problem);
    }

    let logoHref: string | null = null;
    if (input.logoMediaId) {
      const media = await this.media(input.organizationId, input.logoMediaId);
      logoHref = media.sourceUrl;
      if (!logoHref) {
        warnings.push(
          'Le logo est référencé mais sans URL source : il n’a pas pu être intégré au visuel',
        );
      }
    }

    const references: string[] = [];
    for (const mediaId of input.referenceImageIds.slice(0, 8)) {
      const media = await this.media(input.organizationId, mediaId);
      if (media.sourceUrl) references.push(media.sourceUrl);
    }
    if (input.referenceImageIds.length > 0 && references.length === 0) {
      warnings.push('Aucune image de référence exploitable (URL source absente)');
    }

    const palette = input.palette.length > 0 ? input.palette : [];
    const composed = composeImage({
      width: input.width,
      height: input.height,
      format: input.format,
      style: input.style,
      headline: input.headline,
      subheadline: input.subheadline,
      callToAction: input.callToAction,
      badge: input.badge,
      palette,
      logoHref,
      referenceHref: references[0] ?? null,
      brandName: input.brand?.name ?? null,
      slogan: input.brand?.slogan ?? null,
      seed: input.seed,
    });

    return {
      svg: composed.svg,
      warnings: [...composed.warnings, ...warnings],
      palette: palette.length > 0 ? palette : defaultPalette(),
      logoMediaId: input.logoMediaId,
      referenceImageIds: input.referenceImageIds,
      headline: input.headline,
      subheadline: input.subheadline,
      callToAction: input.callToAction,
      badge: input.badge,
    };
  }

  // --- Aides ---

  private async find(organizationId: string, id: string): Promise<ImageRow> {
    const row = await this.db.client.imageProject.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Visuel introuvable');
    return row as unknown as ImageRow;
  }

  private async brand(organizationId: string, brandId: string): Promise<Brand> {
    const row = await this.db.client.brand.findFirst({
      where: { id: brandId, organizationId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Marque introuvable');
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      description: row.description,
      primaryColor: row.primaryColor,
      toneOfVoice: row.toneOfVoice,
      palette: row.palette,
      logoPrimaryId: row.logoPrimaryId,
      logoSecondaryId: row.logoSecondaryId,
      headingFont: row.headingFont,
      bodyFont: row.bodyFont,
      slogan: row.slogan,
      website: row.website,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      socialLinks: (row.socialLinks as Brand['socialLinks'] | null) ?? [],
      referenceImageIds: row.referenceImageIds,
      editorialInstructions: row.editorialInstructions,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async media(
    organizationId: string,
    mediaId: string,
  ): Promise<{ sourceUrl: string | null }> {
    const row = await this.db.client.mediaAsset.findFirst({
      where: { id: mediaId, organizationId, deletedAt: null },
      select: { sourceUrl: true },
    });
    if (!row) throw new NotFoundException(`Média introuvable : ${mediaId}`);
    return { sourceUrl: row.sourceUrl };
  }

  private async audit(
    organizationId: string,
    actorId: string | null,
    action: string,
    targetId: string,
    metadata: Record<string, string | number | boolean> | null,
  ): Promise<void> {
    await this.db.client.auditLog.create({
      data: {
        organizationId,
        actorId,
        action,
        targetType: 'image_project',
        targetId,
        ...(metadata ? { metadata } : {}),
      },
    });
  }

  private toProject(row: ImageRow): ImageProject {
    return {
      id: row.id,
      organizationId: row.organizationId,
      brandId: row.brandId,
      sourceProjectId: row.sourceProjectId,
      title: row.title,
      prompt: row.prompt,
      format: imageFormatSchema.parse(row.format),
      width: row.width,
      height: row.height,
      style: imageStyleSchema.parse(row.style),
      provider: row.provider,
      model: row.model,
      seed: row.seed,
      platform: parsePlatform(row.platform),
      palette: row.palette,
      logoMediaId: row.logoMediaId,
      referenceMediaIds: row.referenceMediaIds,
      headline: row.headline,
      subheadline: row.subheadline,
      callToAction: row.callToAction,
      badge: row.badge,
      warnings: row.warnings,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(row: ImageRow): ImageProjectDetail {
    return { ...this.toProject(row), svg: row.svg };
  }
}

function parsePlatform(value: string | null): SocialPlatform | null {
  return value ? socialPlatformSchema.parse(value) : null;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

function defaultPalette(): string[] {
  return ['#0f172a', '#7c5cff', '#22d3ee'];
}
