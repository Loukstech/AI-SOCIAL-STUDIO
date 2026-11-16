import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  defaultPreference,
  notificationCatalog,
  resolvePreferences,
  socialPlatformLabels,
  socialPlatformSchema,
  type Notification,
  type NotificationCatalogResponse,
  type NotificationChannels,
  type NotificationEmailStatus,
  type NotificationList,
  type NotificationPreference,
  type NotificationQuery,
  type NotificationType,
  type UnreadCount,
  type UpdatePreferencesInput,
} from '@ass/shared';
import { Db } from '../common/validation.js';
import { MAIL_TRANSPORT, noopMailTransport, type MailTransport } from './mail.js';
import {
  mailBody,
  publicationDedupeKey,
  publicationMessage,
  socialExpiredMessage,
  type NotificationMessage,
} from './messages.js';

/**
 * Notifications (§15).
 *
 * Le service ne décide jamais *quand* notifier : il reçoit l'événement. Il
 * décide *qui* le reçoit, sur quel canal, et il en garde la trace.
 *
 * Trois invariants :
 *
 * - **Une notification ne casse jamais l'action qui l'a déclenchée.** Un échec
 *   d'écriture est journalisé, pas propagé : une publication réussie ne doit
 *   pas être annulée parce qu'un avertissement n'a pas pu être déposé.
 * - **La déduplication est une clé, pas une fenêtre temporelle.** Deux échecs
 *   de la même publication se cumulent sur une ligne avec un compteur, plutôt
 *   que de remplir la boîte.
 * - **L'e-mail dit la vérité sur lui-même.** Sans transport, le statut est
 *   `NO_PROVIDER` avec le motif — jamais `SENT`.
 */

export interface NotifyInput {
  organizationId: string;
  recipients: string[];
  type: NotificationType;
  message: NotificationMessage;
  entityType?: string | null;
  entityId?: string | null;
  dedupeKey?: string | null;
  /** Auteur de l'action : jamais destinataire de sa propre notification. */
  actorId?: string | null;
}

export type SkipReason = 'SELF' | 'PREFERENCE_OFF' | 'NOT_WIRED';

export interface NotifyOutcome {
  userId: string;
  /** Une ligne a-t-elle été écrite (créée ou cumulée) ? */
  recorded: boolean;
  /** `true` quand l'événement s'est cumulé sur une notification existante. */
  deduped: boolean;
  emailStatus: NotificationEmailStatus;
  emailError: string | null;
  skipped: SkipReason | null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(Db) private readonly db: Db,
    @Optional() @Inject(MAIL_TRANSPORT) private readonly injectedMail?: MailTransport,
  ) {}

  /** Transport réel, sauf en test où il est fourni explicitement. */
  private get mail(): MailTransport {
    return this.injectedMail ?? noopMailTransport;
  }

  // --- Émission ---

  /**
   * Dépose une notification pour chaque destinataire éligible.
   *
   * Ne lève pas : renvoie le sort réservé à chaque destinataire, ce qui rend
   * l'émission inspectable dans les tests et les journaux.
   */
  async notify(input: NotifyInput): Promise<NotifyOutcome[]> {
    const outcomes: NotifyOutcome[] = [];
    const recipients = [...new Set(input.recipients)];

    for (const userId of recipients) {
      if (userId === input.actorId) {
        outcomes.push({
          userId,
          recorded: false,
          deduped: false,
          emailStatus: 'NOT_REQUESTED',
          emailError: null,
          skipped: 'SELF',
        });
        continue;
      }
      outcomes.push(await this.deliver(input, userId));
    }
    return outcomes;
  }

  private async deliver(input: NotifyInput, userId: string): Promise<NotifyOutcome> {
    const preference = await this.db.client.notificationPreference.findUnique({
      where: {
        organizationId_userId_type: {
          organizationId: input.organizationId,
          userId,
          type: input.type,
        },
      },
    });
    const inApp = preference?.inApp ?? defaultPreference.inApp;
    const wantsEmail = preference?.email ?? defaultPreference.email;

    if (!inApp && !wantsEmail) {
      return {
        userId,
        recorded: false,
        deduped: false,
        emailStatus: 'NOT_REQUESTED',
        emailError: null,
        skipped: 'PREFERENCE_OFF',
      };
    }

    const now = new Date();
    const row = await this.persist(input, userId, inApp, now);
    const deduped = row.occurrences > 1;

    if (!wantsEmail) {
      return {
        userId,
        recorded: true,
        deduped,
        emailStatus: 'NOT_REQUESTED',
        emailError: null,
        skipped: null,
      };
    }

    const email = await this.sendMail(input, userId);
    await this.db.client.notification.update({
      where: { id: row.id },
      data: { emailStatus: email.status, emailError: email.error },
    });

    return {
      userId,
      recorded: true,
      deduped,
      emailStatus: email.status,
      emailError: email.error,
      skipped: null,
    };
  }

  /**
   * Écrit la notification, en cumulant sur une clé de déduplication.
   *
   * L'index unique `(organizationId, userId, dedupeKey)` protège d'une course
   * entre deux émissions simultanées : la seconde insertion échoue, on relit
   * la ligne gagnante et on la cumule.
   */
  private async persist(
    input: NotifyInput,
    userId: string,
    inApp: boolean,
    now: Date,
  ): Promise<{ id: string; occurrences: number }> {
    const data = {
      title: input.message.title,
      body: input.message.body,
      url: input.message.url,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      inApp,
      lastOccurredAt: now,
      readAt: null,
    };

    if (input.dedupeKey) {
      const existing = await this.db.client.notification.findFirst({
        where: {
          organizationId: input.organizationId,
          userId,
          dedupeKey: input.dedupeKey,
        },
        select: { id: true },
      });
      if (existing) {
        return this.db.client.notification.update({
          where: { id: existing.id },
          data: { ...data, occurrences: { increment: 1 } },
          select: { id: true, occurrences: true },
        });
      }
    }

    try {
      return await this.db.client.notification.create({
        data: {
          organizationId: input.organizationId,
          userId,
          type: input.type,
          dedupeKey: input.dedupeKey ?? null,
          ...data,
        },
        select: { id: true, occurrences: true },
      });
    } catch (error) {
      if (input.dedupeKey && isUniqueViolation(error)) {
        const winner = await this.db.client.notification.findFirst({
          where: {
            organizationId: input.organizationId,
            userId,
            dedupeKey: input.dedupeKey,
          },
          select: { id: true },
        });
        if (winner) {
          return this.db.client.notification.update({
            where: { id: winner.id },
            data: { ...data, occurrences: { increment: 1 } },
            select: { id: true, occurrences: true },
          });
        }
      }
      throw error;
    }
  }

  /** Tente l'e-mail et rapporte ce qui s'est réellement passé. */
  private async sendMail(
    input: NotifyInput,
    userId: string,
  ): Promise<{ status: NotificationEmailStatus; error: string | null }> {
    const user = await this.db.client.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) {
      return { status: 'FAILED', error: 'Destinataire introuvable : aucun e-mail à envoyer' };
    }

    const draft = mailBody(input.message, input.type);
    try {
      const result = await this.mail.send({ to: user.email, ...draft });
      if (result.ok) return { status: 'SENT', error: null };
      return {
        status: result.code === 'NO_PROVIDER' ? 'NO_PROVIDER' : 'FAILED',
        error: result.message,
      };
    } catch (error) {
      return {
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Erreur inconnue du transport e-mail',
      };
    }
  }

  // --- Événements de publication ---

  /**
   * Notifie un changement d'état de publication.
   *
   * Ne lève jamais : appelée depuis une transition d'état, elle ne doit pas
   * pouvoir l'annuler. L'échec est journalisé avec le contexte.
   */
  async notifyPublication(
    organizationId: string,
    publicationId: string,
    type: NotificationType,
    options: { actorId?: string | null } = {},
  ): Promise<void> {
    try {
      const publication = await this.db.client.publication.findFirst({
        where: { id: publicationId, organizationId },
        select: {
          id: true,
          title: true,
          createdById: true,
          lastError: true,
          rejectionReason: true,
          targets: { select: { platform: true }, orderBy: { platform: 'asc' } },
        },
      });
      if (!publication) return;

      const platforms = publication.targets.map(
        (target) => socialPlatformLabels[socialPlatformSchema.parse(target.platform)],
      );
      const message = publicationMessage(type, {
        title: publication.title,
        platforms,
        error: publication.lastError,
        reason: publication.rejectionReason,
      });

      // Une demande de validation s'adresse aux responsables ; les autres
      // événements concernent d'abord l'auteur du contenu.
      const recipients =
        type === 'APPROVAL_REQUESTED'
          ? await this.approvers(organizationId)
          : await this.audienceFor(organizationId, publication.createdById);

      await this.notify({
        organizationId,
        recipients,
        type,
        message,
        entityType: 'publication',
        entityId: publication.id,
        dedupeKey: publicationDedupeKey(publication.id, type),
        actorId: options.actorId ?? null,
      });
    } catch (error) {
      this.logger.error(
        `Notification ${type} non déposée pour la publication ${publicationId} : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Notifie qu'une connexion sociale est tombée. */
  async notifySocialExpired(
    organizationId: string,
    accountId: string,
    error: string | null,
    options: { actorId?: string | null } = {},
  ): Promise<void> {
    try {
      const account = await this.db.client.socialAccount.findFirst({
        where: { id: accountId, organizationId, deletedAt: null },
        select: { id: true, username: true, platform: true },
      });
      if (!account) return;

      const platform = socialPlatformSchema.parse(account.platform);
      const message = socialExpiredMessage({
        platformLabel: socialPlatformLabels[platform],
        username: account.username,
        error,
      });

      await this.notify({
        organizationId,
        recipients: await this.approvers(organizationId),
        type: 'SOCIAL_CONNECTION_EXPIRED',
        message,
        entityType: 'social_account',
        entityId: account.id,
        dedupeKey: `social:${account.id}:expired`,
        actorId: options.actorId ?? null,
      });
    } catch (cause) {
      this.logger.error(
        `Notification de connexion expirée non déposée pour ${accountId} : ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }

  /** Propriétaires et administrateurs : les décideurs de l'organisation. */
  private async approvers(organizationId: string): Promise<string[]> {
    const rows = await this.db.client.member.findMany({
      where: { organizationId, role: { in: ['OWNER', 'ADMIN'] } },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  /**
   * Destinataires d'un événement de contenu : l'auteur s'il est encore membre,
   * sinon les responsables — une organisation ne doit pas perdre l'information
   * parce que l'auteur a quitté l'espace.
   */
  private async audienceFor(organizationId: string, authorId: string | null): Promise<string[]> {
    if (authorId) {
      const member = await this.db.client.member.findUnique({
        where: { userId_organizationId: { userId: authorId, organizationId } },
        select: { userId: true },
      });
      if (member) return [member.userId];
    }
    return this.approvers(organizationId);
  }

  // --- Boîte de réception ---

  async list(
    organizationId: string,
    userId: string,
    query: NotificationQuery,
  ): Promise<NotificationList> {
    const where = {
      organizationId,
      userId,
      inApp: true,
      ...(query.unread ? { readAt: null } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const [rows, total, unread] = await Promise.all([
      this.db.client.notification.findMany({
        where,
        orderBy: [{ lastOccurredAt: 'desc' }, { createdAt: 'desc' }],
        take: query.limit,
      }),
      this.db.client.notification.count({ where }),
      this.unreadCount(organizationId, userId),
    ]);

    return { items: rows.map(toNotification), total, unread: unread.unread, limit: query.limit };
  }

  async unreadCount(organizationId: string, userId: string): Promise<UnreadCount> {
    const unread = await this.db.client.notification.count({
      where: { organizationId, userId, inApp: true, readAt: null },
    });
    return { unread };
  }

  /** Marque une notification comme lue. Une notification d'autrui est invisible. */
  async markRead(organizationId: string, userId: string, id: string): Promise<Notification> {
    const updated = await this.db.client.notification.updateMany({
      where: { id, organizationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (updated.count === 0) {
      const exists = await this.db.client.notification.findFirst({
        where: { id, organizationId, userId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Notification introuvable');
    }
    const row = await this.db.client.notification.findFirstOrThrow({
      where: { id, organizationId, userId },
    });
    return toNotification(row);
  }

  async markAllRead(organizationId: string, userId: string): Promise<UnreadCount> {
    await this.db.client.notification.updateMany({
      where: { organizationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { unread: 0 };
  }

  async remove(organizationId: string, userId: string, id: string): Promise<void> {
    const deleted = await this.db.client.notification.deleteMany({
      where: { id, organizationId, userId },
    });
    if (deleted.count === 0) throw new NotFoundException('Notification introuvable');
  }

  // --- Préférences et catalogue ---

  async preferences(organizationId: string, userId: string): Promise<NotificationPreference[]> {
    const rows = await this.db.client.notificationPreference.findMany({
      where: { organizationId, userId },
      select: { type: true, inApp: true, email: true },
    });
    return resolvePreferences(rows);
  }

  /**
   * Enregistre les préférences fournies.
   *
   * Seules les lignes transmises sont écrites : une préférence non touchée
   * reste à sa valeur par défaut, ce qui évite de figer un réglage que
   * l'utilisateur n'a jamais exprimé.
   */
  async updatePreferences(
    organizationId: string,
    userId: string,
    input: UpdatePreferencesInput,
  ): Promise<NotificationPreference[]> {
    for (const entry of input.preferences) {
      const current = await this.db.client.notificationPreference.findUnique({
        where: {
          organizationId_userId_type: { organizationId, userId, type: entry.type },
        },
        select: { inApp: true, email: true },
      });
      const inApp = entry.inApp ?? current?.inApp ?? defaultPreference.inApp;
      const email = entry.email ?? current?.email ?? defaultPreference.email;

      await this.db.client.notificationPreference.upsert({
        where: {
          organizationId_userId_type: { organizationId, userId, type: entry.type },
        },
        create: { organizationId, userId, type: entry.type, inApp, email },
        update: { inApp, email },
      });
    }
    return this.preferences(organizationId, userId);
  }

  /** Ce que le déploiement sait réellement faire sur le canal e-mail. */
  channels(): NotificationChannels {
    return { email: this.mail.describe() };
  }

  /**
   * Catalogue des événements du §15 avec leur état réel.
   *
   * Les types non branchés y figurent avec leur motif : l'interface peut donc
   * afficher la liste complète sans laisser croire qu'ils fonctionnent.
   */
  catalog(): NotificationCatalogResponse {
    return { events: notificationCatalog, ...this.channels() };
  }
}

// --- Aides ---

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  url: string | null;
  occurrences: number;
  readAt: Date | null;
  createdAt: Date;
  lastOccurredAt: Date;
  emailStatus: string;
  emailError: string | null;
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    entityType: row.entityType,
    entityId: row.entityId,
    url: row.url,
    occurrences: row.occurrences,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    lastOccurredAt: row.lastOccurredAt.toISOString(),
    email: {
      status: row.emailStatus as NotificationEmailStatus,
      reason: row.emailError,
    },
  };
}
