import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MAX_PUBLISH_ATTEMPTS,
  canTransition,
  composePublicationText,
  platformCapabilities,
  platformSpecs,
  postTypeSchema,
  publicationModeSchema,
  publicationStatusSchema,
  publicationTransitions,
  socialPlatformSchema,
  type ConfirmPublicationInput,
  type CreatePublicationInput,
  type PostType,
  type Publication,
  type PublicationAlternative,
  type PublicationDetail,
  type PublicationEvent,
  type PublicationExport,
  type PublicationList,
  type PublicationQuery,
  type PublicationStatus,
  type PublicationTargetView,
  type SchedulePublicationInput,
  type SocialPlatform,
  type UpdatePublicationInput,
} from '@ass/shared';
import { Db } from '../common/validation.js';
import { ENV, type Env } from '../config/env.js';
import { checkPublication, checkTarget } from './capabilities.js';
import {
  createConnector,
  describePlatforms,
  describeReadiness,
  type SocialPost,
} from './connectors.js';
import { isKnownTimezone } from './timezone.js';

/**
 * Publishing Center (§10).
 *
 * Deux principes tenus par ce service :
 * 1. une publication ne saute jamais une étape du circuit de validation ;
 * 2. aucune publication n'est marquée `PUBLISHED` sans preuve — soit un
 *    identifiant renvoyé par le transport, soit une URL fournie à la
 *    confirmation manuelle.
 */

interface TargetRow {
  id: string;
  socialAccountId: string;
  platform: string;
  body: string;
  title: string | null;
  hashtags: string[];
  status: string;
  externalUrl: string | null;
  error: string | null;
  publishedAt: Date | null;
  socialAccount: { username: string };
}

interface EventRow {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: string | null;
  reason: string | null;
  createdAt: Date;
}

interface PublicationRow {
  id: string;
  organizationId: string;
  brandId: string | null;
  contentProjectId: string | null;
  title: string | null;
  postType: string;
  mode: string;
  status: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  timezone: string;
  attempts: number;
  lastError: string | null;
  rejectionReason: string | null;
  mediaIds: string[];
  createdAt: Date;
  updatedAt: Date;
  targets: TargetRow[];
  events?: EventRow[];
}

/** États dans lesquels le contenu reste modifiable. */
const EDITABLE_STATUSES: PublicationStatus[] = ['DRAFT', 'REJECTED', 'EXPIRED'];

/** États depuis lesquels un retour au brouillon est possible. */
const REOPENABLE_STATUSES: PublicationStatus[] = [
  'READY_FOR_REVIEW',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
];

/** Délai au-delà duquel une publication programmée est considérée périmée. */
const EXPIRY_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const detailInclude = {
  targets: { include: { socialAccount: true }, orderBy: { platform: 'asc' } },
  events: { orderBy: { createdAt: 'asc' } },
} as const;

@Injectable()
export class PublicationsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // --- Lecture ---

  async list(organizationId: string, query: PublicationQuery): Promise<PublicationList> {
    const where = {
      organizationId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.platform ? { targets: { some: { platform: query.platform } } } : {}),
      ...(query.from || query.to
        ? {
            scheduledAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.client.publication.findMany({
        where,
        include: { targets: { select: { platform: true } } },
        orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.db.client.publication.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toPublication(row as unknown as PublicationRow)),
      total,
    };
  }

  async detail(organizationId: string, id: string): Promise<PublicationDetail> {
    const row = await this.find(organizationId, id);
    return this.toDetail(row);
  }

  /** Entrées du calendrier sur une fenêtre donnée (§11). */
  async calendar(
    organizationId: string,
    window: {
      from: string;
      to: string;
      platform?: SocialPlatform;
      brandId?: string;
      status?: PublicationStatus;
    },
  ): Promise<PublicationRow[]> {
    const rows = await this.db.client.publication.findMany({
      where: {
        organizationId,
        deletedAt: null,
        scheduledAt: { gte: new Date(window.from), lte: new Date(window.to) },
        ...(window.brandId ? { brandId: window.brandId } : {}),
        ...(window.status ? { status: window.status } : {}),
        ...(window.platform ? { targets: { some: { platform: window.platform } } } : {}),
      },
      include: { targets: { select: { platform: true } } },
      orderBy: { scheduledAt: 'asc' },
      take: 500,
    });
    return rows as unknown as PublicationRow[];
  }

  readiness() {
    return { ...describeReadiness(this.env), platforms: describePlatforms(this.env) };
  }

  /** Réponse du calendrier : entrées + fuseau de l'organisation (§11). */
  async calendarResponse(
    organizationId: string,
    window: {
      from: string;
      to: string;
      platform?: SocialPlatform;
      brandId?: string;
      status?: PublicationStatus;
    },
  ) {
    const organization = await this.organization(organizationId);
    const rows = await this.calendar(organizationId, window);
    return {
      timezone: organization.timezone,
      from: window.from,
      to: window.to,
      entries: rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: publicationStatusSchema.parse(row.status),
        mode: publicationModeSchema.parse(row.mode),
        postType: postTypeSchema.parse(row.postType),
        scheduledAt: row.scheduledAt?.toISOString() ?? new Date().toISOString(),
        publishedAt: row.publishedAt?.toISOString() ?? null,
        platforms: [
          ...new Set(row.targets.map((target) => socialPlatformSchema.parse(target.platform))),
        ],
        brandId: row.brandId,
        timezone: row.timezone,
      })),
    };
  }

  // --- Écriture ---

  async create(
    organizationId: string,
    actorId: string,
    input: CreatePublicationInput,
  ): Promise<PublicationDetail> {
    const organization = await this.organization(organizationId);
    if (input.brandId) await this.assertBrand(organizationId, input.brandId);
    if (input.contentProjectId) {
      await this.assertContentProject(organizationId, input.contentProjectId);
    }
    const accounts = await this.accounts(
      organizationId,
      input.targets.map((target) => target.socialAccountId),
    );

    const postType: PostType = input.postType ?? 'TEXT';
    const created = await this.db.client.publication.create({
      data: {
        organizationId,
        createdById: actorId,
        postType,
        mode: input.mode ?? 'AUTO',
        timezone: input.timezone ?? organization.timezone,
        mediaIds: input.mediaIds ?? [],
        ...(input.title ? { title: input.title } : {}),
        ...(input.brandId ? { brandId: input.brandId } : {}),
        ...(input.contentProjectId ? { contentProjectId: input.contentProjectId } : {}),
        ...(input.scheduledAt ? { scheduledAt: new Date(input.scheduledAt) } : {}),
        targets: {
          create: input.targets.map((target) => ({
            socialAccountId: target.socialAccountId,
            platform: accounts.get(target.socialAccountId)!.platform,
            body: target.body,
            title: target.title ?? null,
            hashtags: target.hashtags ?? [],
          })),
        },
        events: { create: { toStatus: 'DRAFT', actorId } },
      },
      include: detailInclude,
    });

    await this.audit(organizationId, actorId, 'publication.created', created.id, {
      targets: input.targets.length,
      postType,
    });
    return this.toDetail(created as unknown as PublicationRow);
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdatePublicationInput,
  ): Promise<PublicationDetail> {
    const row = await this.find(organizationId, id);
    const status = publicationStatusSchema.parse(row.status);
    if (!EDITABLE_STATUSES.includes(status)) {
      throw new ConflictException(
        `Une publication « ${status} » n’est plus modifiable : repassez-la en brouillon d’abord`,
      );
    }
    if (input.brandId) await this.assertBrand(organizationId, input.brandId);

    if (input.targets) {
      const accounts = await this.accounts(
        organizationId,
        input.targets.map((target) => target.socialAccountId),
      );
      const keep = input.targets.map((target) => target.socialAccountId);
      await this.db.client.publicationTarget.deleteMany({
        where: { publicationId: id, socialAccountId: { notIn: keep } },
      });
      for (const target of input.targets) {
        await this.db.client.publicationTarget.upsert({
          where: {
            publicationId_socialAccountId: {
              publicationId: id,
              socialAccountId: target.socialAccountId,
            },
          },
          create: {
            publicationId: id,
            socialAccountId: target.socialAccountId,
            platform: accounts.get(target.socialAccountId)!.platform,
            body: target.body,
            title: target.title ?? null,
            hashtags: target.hashtags ?? [],
          },
          update: {
            body: target.body,
            title: target.title ?? null,
            hashtags: target.hashtags ?? [],
          },
        });
      }
    }

    await this.db.client.publication.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.postType ? { postType: input.postType } : {}),
        ...(input.mode ? { mode: input.mode } : {}),
        ...(input.brandId !== undefined ? { brandId: input.brandId } : {}),
        ...(input.scheduledAt !== undefined
          ? { scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null }
          : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
        ...(input.mediaIds ? { mediaIds: input.mediaIds } : {}),
      },
    });

    await this.audit(organizationId, null, 'publication.updated', id, null);
    return this.detail(organizationId, id);
  }

  // --- Transitions ---

  async submit(organizationId: string, id: string, actorId: string): Promise<PublicationDetail> {
    const row = await this.find(organizationId, id);
    await this.ensureReady(row);
    await this.apply(row, 'READY_FOR_REVIEW', actorId, null);
    // En mode AUTO il n'y a pas de responsable à solliciter : la validation
    // est enregistrée comme automatique, ce qui laisse une trace lisible.
    if (publicationModeSchema.parse(row.mode) === 'AUTO') {
      const fresh = await this.find(organizationId, id);
      await this.apply(fresh, 'APPROVED', actorId, 'Validation automatique (mode AUTO)');
    }
    return this.detail(organizationId, id);
  }

  async requestApproval(
    organizationId: string,
    id: string,
    actorId: string,
  ): Promise<PublicationDetail> {
    const row = await this.find(organizationId, id);
    await this.ensureReady(row);
    await this.apply(row, 'PENDING_APPROVAL', actorId, null);
    return this.detail(organizationId, id);
  }

  async approve(organizationId: string, id: string, actorId: string): Promise<PublicationDetail> {
    const row = await this.find(organizationId, id);
    await this.apply(row, 'APPROVED', actorId, null);
    return this.detail(organizationId, id);
  }

  async reject(
    organizationId: string,
    id: string,
    actorId: string,
    reason: string,
  ): Promise<PublicationDetail> {
    const row = await this.find(organizationId, id);
    await this.apply(row, 'REJECTED', actorId, reason, { rejectionReason: reason });
    return this.detail(organizationId, id);
  }

  async reopen(organizationId: string, id: string, actorId: string): Promise<PublicationDetail> {
    const row = await this.find(organizationId, id);
    const status = publicationStatusSchema.parse(row.status);
    if (!REOPENABLE_STATUSES.includes(status)) {
      throw new ConflictException(`Impossible de repasser en brouillon depuis « ${status} »`);
    }
    await this.apply(row, 'DRAFT', actorId, 'Retour en brouillon');
    return this.detail(organizationId, id);
  }

  async schedule(
    organizationId: string,
    id: string,
    actorId: string,
    input: SchedulePublicationInput,
  ): Promise<PublicationDetail> {
    const row = await this.find(organizationId, id);
    if (input.timezone && !isKnownTimezone(input.timezone)) {
      throw new BadRequestException(`Fuseau horaire inconnu : ${input.timezone}`);
    }
    await this.ensureReady(row);
    await this.apply(row, 'SCHEDULED', actorId, null, {
      scheduledAt: new Date(input.scheduledAt),
      ...(input.timezone ? { timezone: input.timezone } : {}),
    });
    return this.detail(organizationId, id);
  }

  async cancel(
    organizationId: string,
    id: string,
    actorId: string,
    reason: string | null,
  ): Promise<PublicationDetail> {
    const row = await this.find(organizationId, id);
    await this.apply(row, 'CANCELLED', actorId, reason);
    return this.detail(organizationId, id);
  }

  /**
   * Déplacement d'échéance (§11, glisser-déposer). Une publication déjà
   * programmée garde son statut : seule la date change. Un brouillon ou un
   * contenu validé suit le chemin normal.
   */
  async reschedule(
    organizationId: string,
    id: string,
    actorId: string,
    input: SchedulePublicationInput,
  ): Promise<PublicationDetail> {
    const row = await this.find(organizationId, id);
    const status = publicationStatusSchema.parse(row.status);
    if (input.timezone && !isKnownTimezone(input.timezone)) {
      throw new BadRequestException(`Fuseau horaire inconnu : ${input.timezone}`);
    }

    if (status === 'SCHEDULED') {
      await this.db.client.publication.update({
        where: { id },
        data: {
          scheduledAt: new Date(input.scheduledAt),
          ...(input.timezone ? { timezone: input.timezone } : {}),
        },
      });
      await this.db.client.publicationEvent.create({
        data: {
          publicationId: id,
          fromStatus: 'SCHEDULED',
          toStatus: 'SCHEDULED',
          actorId,
          reason: 'Échéance modifiée',
        },
      });
      await this.audit(organizationId, actorId, 'publication.rescheduled', id, null);
      return this.detail(organizationId, id);
    }

    if (status === 'APPROVED') {
      return this.schedule(organizationId, id, actorId, input);
    }

    if (EDITABLE_STATUSES.includes(status)) {
      await this.db.client.publication.update({
        where: { id },
        data: {
          scheduledAt: new Date(input.scheduledAt),
          ...(input.timezone ? { timezone: input.timezone } : {}),
        },
      });
      await this.audit(organizationId, actorId, 'publication.rescheduled', id, null);
      return this.detail(organizationId, id);
    }

    throw new ConflictException(
      `Impossible de déplacer une publication « ${status} » : repassez-la en brouillon`,
    );
  }

  /** Publication immédiate : passe en PUBLISHING puis exécute tout de suite. */
  async publishNow(
    organizationId: string,
    id: string,
    actorId: string,
  ): Promise<PublicationDetail> {
    const row = await this.find(organizationId, id);
    await this.ensureReady(row);
    await this.apply(row, 'PUBLISHING', actorId, 'Publication immédiate');
    await this.execute(id);
    return this.detail(organizationId, id);
  }

  /** Nouvelle tentative après échec, bornée par MAX_PUBLISH_ATTEMPTS. */
  async retry(organizationId: string, id: string, actorId: string): Promise<PublicationDetail> {
    const row = await this.find(organizationId, id);
    if (row.attempts >= MAX_PUBLISH_ATTEMPTS) {
      throw new ConflictException(
        `Nombre maximal de tentatives atteint (${MAX_PUBLISH_ATTEMPTS}). Corrigez la publication ou repassez-la en brouillon.`,
      );
    }
    // Les cibles en échec redeviennent éligibles, les cibles déjà publiées restent acquises.
    await this.db.client.publicationTarget.updateMany({
      where: { publicationId: id, status: 'FAILED' },
      data: { status: 'PENDING', error: null },
    });
    await this.apply(row, 'PUBLISHING', actorId, 'Nouvelle tentative');
    await this.execute(id);
    return this.detail(organizationId, id);
  }

  /**
   * Confirmation d'une publication faite à la main. L'URL est obligatoire :
   * c'est la seule preuve acceptable en l'absence d'adaptateur.
   */
  async confirm(
    organizationId: string,
    id: string,
    actorId: string,
    input: ConfirmPublicationInput,
  ): Promise<PublicationDetail> {
    const row = await this.find(organizationId, id);
    const status = publicationStatusSchema.parse(row.status);
    if (status !== 'PUBLISHING' && status !== 'FAILED') {
      throw new ConflictException(
        `La confirmation n’a de sens qu’après une tentative : état actuel « ${status} »`,
      );
    }

    const byId = new Map(row.targets.map((target) => [target.id, target]));
    for (const entry of input.targets) {
      const target = byId.get(entry.targetId);
      if (!target) {
        throw new NotFoundException(`Cible ${entry.targetId} absente de cette publication`);
      }
      await this.db.client.publicationTarget.update({
        where: { id: target.id },
        data: {
          status: 'PUBLISHED',
          externalUrl: entry.url,
          error: null,
          publishedAt: new Date(),
        },
      });
    }

    const refreshed = await this.find(organizationId, id);
    const currentStatus = publicationStatusSchema.parse(refreshed.status);
    const allPublished = refreshed.targets.every((target) => target.status === 'PUBLISHED');
    if (allPublished) {
      await this.apply(refreshed, 'PUBLISHED', actorId, 'Publication confirmée manuellement', {
        publishedAt: new Date(),
        lastError: null,
      });
    } else {
      await this.db.client.publicationEvent.create({
        data: {
          publicationId: id,
          fromStatus: currentStatus,
          toStatus: currentStatus,
          actorId,
          reason: `Confirmation partielle : ${input.targets.length} cible(s)`,
        },
      });
    }
    await this.audit(organizationId, actorId, 'publication.confirmed', id, {
      targets: input.targets.length,
    });
    return this.detail(organizationId, id);
  }

  /** Duplication : nouvelle publication en brouillon, sans échéance. */
  async duplicate(
    organizationId: string,
    id: string,
    actorId: string,
    title: string | null,
  ): Promise<PublicationDetail> {
    const row = await this.find(organizationId, id);
    const created = await this.db.client.publication.create({
      data: {
        organizationId,
        createdById: actorId,
        postType: postTypeSchema.parse(row.postType),
        mode: publicationModeSchema.parse(row.mode),
        timezone: row.timezone,
        mediaIds: row.mediaIds,
        title: title ?? (row.title ? `${row.title} (copie)` : null),
        ...(row.brandId ? { brandId: row.brandId } : {}),
        ...(row.contentProjectId ? { contentProjectId: row.contentProjectId } : {}),
        targets: {
          create: row.targets.map((target) => ({
            socialAccountId: target.socialAccountId,
            platform: socialPlatformSchema.parse(target.platform),
            body: target.body,
            title: target.title,
            hashtags: target.hashtags,
          })),
        },
        events: { create: { toStatus: 'DRAFT', actorId, reason: 'Duplication' } },
      },
      include: detailInclude,
    });
    await this.audit(organizationId, actorId, 'publication.duplicated', created.id, {
      sourceId: id,
    });
    return this.toDetail(created as unknown as PublicationRow);
  }

  async remove(organizationId: string, id: string, actorId: string): Promise<void> {
    const row = await this.find(organizationId, id);
    if (publicationStatusSchema.parse(row.status) === 'PUBLISHING') {
      throw new ConflictException('Publication en cours : attendez la fin de l’envoi');
    }
    await this.db.client.publication.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit(organizationId, actorId, 'publication.deleted', id, null);
  }

  /** Export texte par cible : le repli quand la publication directe est impossible. */
  async exportPayload(organizationId: string, id: string): Promise<PublicationExport> {
    const row = await this.find(organizationId, id);
    const postType = postTypeSchema.parse(row.postType);
    return {
      publicationId: row.id,
      title: row.title,
      postType,
      timezone: row.timezone,
      targets: row.targets.map((target) => {
        const platform = socialPlatformSchema.parse(target.platform);
        const text = composePublicationText(target.body, target.hashtags);
        return {
          platform,
          username: target.socialAccount.username,
          title: target.title,
          text,
          charCount: text.length,
          charLimit: platformSpecs[platform].maxChars,
        };
      }),
    };
  }

  // --- Moteur de publication ---

  /**
   * Réclame les publications arrivées à échéance et les envoie.
   * L'écriture conditionnelle (`where: status = SCHEDULED`) sert de verrou :
   * deux instances ne peuvent pas envoyer la même publication.
   */
  async claimDue(now = new Date()): Promise<{ claimed: number; expired: number }> {
    const stale = await this.db.client.publication.findMany({
      where: {
        status: 'SCHEDULED',
        deletedAt: null,
        scheduledAt: { lt: new Date(now.getTime() - EXPIRY_GRACE_MS) },
      },
      select: { id: true },
      take: 50,
    });
    for (const item of stale) {
      await this.db.client.publication.update({
        where: { id: item.id },
        data: { status: 'EXPIRED' },
      });
      await this.db.client.publicationEvent.create({
        data: {
          publicationId: item.id,
          fromStatus: 'SCHEDULED',
          toStatus: 'EXPIRED',
          reason: 'Échéance dépassée de plus de 7 jours sans envoi',
        },
      });
    }

    const due = await this.db.client.publication.findMany({
      where: { status: 'SCHEDULED', deletedAt: null, scheduledAt: { lte: now } },
      orderBy: { scheduledAt: 'asc' },
      select: { id: true },
      take: 20,
    });

    let claimed = 0;
    for (const item of due) {
      const claimedRow = await this.db.client.publication.updateMany({
        where: { id: item.id, status: 'SCHEDULED' },
        data: { status: 'PUBLISHING' },
      });
      if (claimedRow.count !== 1) continue;
      claimed += 1;
      await this.db.client.publicationEvent.create({
        data: {
          publicationId: item.id,
          fromStatus: 'SCHEDULED',
          toStatus: 'PUBLISHING',
          reason: 'Échéance atteinte',
        },
      });
      await this.execute(item.id);
    }
    return { claimed, expired: stale.length };
  }

  /** Envoi effectif. Suppose la publication déjà en `PUBLISHING`. */
  private async execute(publicationId: string): Promise<void> {
    const row = await this.db.client.publication.findUnique({
      where: { id: publicationId },
      include: detailInclude,
    });
    if (!row || row.status !== 'PUBLISHING') return;

    const current = row as unknown as PublicationRow;
    const postType = postTypeSchema.parse(current.postType);

    let published = 0;
    let failed = 0;
    let firstError: string | null = null;

    for (const target of current.targets) {
      if (target.status === 'PUBLISHED') {
        published += 1;
        continue;
      }
      const platform = socialPlatformSchema.parse(target.platform);
      const connector = createConnector(this.env, platform);
      const post: SocialPost = {
        platform,
        accountUsername: target.socialAccount.username,
        postType,
        text: composePublicationText(target.body, target.hashtags),
        title: target.title,
        mediaIds: current.mediaIds,
      };

      // La validation appartient à l'adaptateur de la plateforme (§9.4) : une
      // règle non respectée ne part pas, inutile d'appeler le réseau pour se
      // faire refuser.
      const validation = await connector.validatePost(post);
      if (!validation.ok) {
        failed += 1;
        firstError ??= validation.errors[0] ?? 'Cible invalide';
        await this.db.client.publicationTarget.update({
          where: { id: target.id },
          data: { status: 'FAILED', error: validation.errors.join(' · ') },
        });
        continue;
      }

      const result = await connector.publish(post);

      if (result.ok) {
        published += 1;
        await this.db.client.publicationTarget.update({
          where: { id: target.id },
          data: {
            status: 'PUBLISHED',
            externalId: result.externalId,
            externalUrl: result.externalUrl,
            error: null,
            publishedAt: new Date(),
          },
        });
      } else {
        failed += 1;
        const message = result.error?.message ?? 'Échec de publication';
        firstError ??= message;
        await this.db.client.publicationTarget.update({
          where: { id: target.id },
          data: { status: 'FAILED', error: message },
        });
      }
    }

    const attempts = current.attempts + 1;
    const refreshed = await this.find(current.organizationId, current.id);
    if (failed === 0 && published > 0) {
      await this.apply(refreshed, 'PUBLISHED', null, null, {
        publishedAt: new Date(),
        attempts,
        lastError: null,
      });
    } else {
      await this.apply(refreshed, 'FAILED', null, firstError, {
        attempts,
        lastError: firstError,
      });
    }
  }

  // --- Aides internes ---

  private async apply(
    row: PublicationRow,
    to: PublicationStatus,
    actorId: string | null,
    reason: string | null,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const from = publicationStatusSchema.parse(row.status);
    if (!canTransition(from, to)) {
      throw new ConflictException(
        `Transition impossible : ${from} → ${to}. Étapes autorisées : ${
          publicationTransitions[from].join(', ') || 'aucune'
        }`,
      );
    }
    await this.db.client.publication.update({
      where: { id: row.id },
      data: { status: to, ...extra },
    });
    await this.db.client.publicationEvent.create({
      data: { publicationId: row.id, fromStatus: from, toStatus: to, actorId, reason },
    });
  }

  private async ensureReady(row: PublicationRow): Promise<void> {
    const postType = postTypeSchema.parse(row.postType);
    const check = checkPublication(
      postType,
      row.targets.map((target) => ({
        platform: socialPlatformSchema.parse(target.platform),
        body: target.body,
        title: target.title,
        hashtags: target.hashtags,
        mediaCount: row.mediaIds.length,
      })),
    );
    if (!check.ok) {
      throw new BadRequestException(check.errors);
    }
  }

  private async find(organizationId: string, id: string): Promise<PublicationRow> {
    const row = await this.db.client.publication.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: detailInclude,
    });
    if (!row) throw new NotFoundException('Publication introuvable');
    return row as unknown as PublicationRow;
  }

  private async organization(organizationId: string): Promise<{ timezone: string }> {
    const organization = await this.db.client.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: { timezone: true },
    });
    if (!organization) throw new NotFoundException('Organisation introuvable');
    return organization;
  }

  private async accounts(
    organizationId: string,
    ids: string[],
  ): Promise<Map<string, { platform: SocialPlatform }>> {
    const unique = [...new Set(ids)];
    const rows = await this.db.client.socialAccount.findMany({
      where: { id: { in: unique }, organizationId, deletedAt: null },
      select: { id: true, platform: true, status: true, username: true },
    });
    const map = new Map<string, { platform: SocialPlatform }>();
    for (const row of rows) {
      if (row.status === 'REVOKED') {
        throw new BadRequestException(`Le compte ${row.username} a été déconnecté`);
      }
      map.set(row.id, { platform: socialPlatformSchema.parse(row.platform) });
    }
    const missing = unique.filter((id) => !map.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(`Compte social introuvable : ${missing.join(', ')}`);
    }
    return map;
  }

  private async assertBrand(organizationId: string, brandId: string): Promise<void> {
    const brand = await this.db.client.brand.findFirst({
      where: { id: brandId, organizationId, deletedAt: null },
    });
    if (!brand) throw new NotFoundException('Marque introuvable');
  }

  private async assertContentProject(organizationId: string, projectId: string): Promise<void> {
    const project = await this.db.client.contentProject.findFirst({
      where: { id: projectId, organizationId, deletedAt: null },
    });
    if (!project) throw new NotFoundException('Projet de contenu introuvable');
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
        targetType: 'publication',
        targetId,
        ...(metadata ? { metadata } : {}),
      },
    });
  }

  // --- Projections ---

  toPublication(row: PublicationRow): Publication {
    const status = publicationStatusSchema.parse(row.status);
    const attempts = row.attempts;
    const transitions =
      status === 'FAILED' && attempts >= MAX_PUBLISH_ATTEMPTS
        ? publicationTransitions[status].filter(
            (next) => next !== 'PUBLISHING' && next !== 'SCHEDULED',
          )
        : publicationTransitions[status];
    const platforms = [...new Set(row.targets.map((target) => target.platform))].map((platform) =>
      socialPlatformSchema.parse(platform),
    );

    return {
      id: row.id,
      organizationId: row.organizationId,
      brandId: row.brandId,
      contentProjectId: row.contentProjectId,
      title: row.title,
      postType: postTypeSchema.parse(row.postType),
      mode: publicationModeSchema.parse(row.mode),
      status,
      scheduledAt: row.scheduledAt?.toISOString() ?? null,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      timezone: row.timezone,
      attempts,
      lastError: row.lastError,
      rejectionReason: row.rejectionReason,
      mediaIds: row.mediaIds,
      platforms,
      targetCount: row.targets.length,
      allowedTransitions: transitions,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(row: PublicationRow): PublicationDetail {
    const base = this.toPublication(row);
    return {
      ...base,
      targets: row.targets.map((target) => this.toTargetView(target, base.postType, row)),
      events: (row.events ?? []).map((event) => this.toEvent(event)),
      alternatives: this.alternatives(row),
    };
  }

  private toTargetView(
    target: TargetRow,
    postType: PostType,
    row: PublicationRow,
  ): PublicationTargetView {
    const platform = socialPlatformSchema.parse(target.platform);
    const check = checkTarget({
      platform,
      postType,
      body: target.body,
      title: target.title,
      hashtags: target.hashtags,
      mediaCount: row.mediaIds.length,
    });
    return {
      id: target.id,
      socialAccountId: target.socialAccountId,
      platform,
      username: target.socialAccount.username,
      body: target.body,
      title: target.title,
      hashtags: target.hashtags,
      status: target.status as PublicationTargetView['status'],
      externalUrl: target.externalUrl,
      error: target.error,
      publishedAt: target.publishedAt?.toISOString() ?? null,
      charCount: check.charCount,
      charLimit: check.charLimit,
      warnings: check.warnings,
      errors: check.errors,
    };
  }

  private toEvent(event: EventRow): PublicationEvent {
    return {
      id: event.id,
      fromStatus: event.fromStatus ? publicationStatusSchema.parse(event.fromStatus) : null,
      toStatus: publicationStatusSchema.parse(event.toStatus),
      actorId: event.actorId,
      reason: event.reason,
      createdAt: event.createdAt.toISOString(),
    };
  }

  /** Replis proposés quand la publication directe est impossible (§10.4). */
  private alternatives(row: PublicationRow): PublicationAlternative[] {
    if (describeReadiness(this.env).ready) return [];
    const failed = row.targets.filter((target) => target.status === 'FAILED');
    if (failed.length === 0) return [];

    const seen = new Set<SocialPlatform>();
    const alternatives: PublicationAlternative[] = [];
    for (const target of failed) {
      const platform = socialPlatformSchema.parse(target.platform);
      if (seen.has(platform)) continue;
      seen.add(platform);
      const capability = platformCapabilities[platform];
      alternatives.push({
        kind: capability.fallback,
        label:
          capability.fallback === 'EXPORT'
            ? `Exporter le texte pour ${capability.label}`
            : `Publier manuellement sur ${capability.label}`,
        detail: capability.note,
      });
    }
    alternatives.push({
      kind: 'MANUAL',
      label: 'Confirmer une publication manuelle',
      detail:
        'Publiez sur le réseau puis renseignez l’URL : la publication est marquée publiée sans jamais simuler un succès.',
    });
    return alternatives;
  }
}
