import { describe, expect, it } from 'vitest';
import {
  badgeLabel,
  catalogEntry,
  defaultPreference,
  notificationCatalog,
  notificationTypeLabels,
  notificationTypes,
  occurrencesLabel,
  resolvePreferences,
  wiredNotificationTypes,
  type NotificationType,
} from '@ass/shared';
import type { Db } from '../common/validation.js';
import { NO_PROVIDER_REASON, noopMailTransport, type MailTransport } from './mail.js';
import {
  dedupeKeyFor,
  mailBody,
  publicationDedupeKey,
  publicationMessage,
  shortTitle,
  socialExpiredMessage,
} from './messages.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Ces tests protègent deux choses :
 *
 * - **le §15 est couvert sans être maquillé** : les dix événements existent,
 *   ceux qui ne peuvent pas être émis le disent avec leur motif ;
 * - **une notification ne ment jamais sur son canal** : sans transport,
 *   l'e-mail est `NO_PROVIDER`, jamais `SENT`.
 */

// --- Rédaction ---

describe('rédaction des notifications', () => {
  it('reprend un titre lisible, ou dit qu’il n’y en a pas', () => {
    expect(shortTitle(null)).toBe('Publication sans titre');
    expect(shortTitle('   ')).toBe('Publication sans titre');
    expect(shortTitle('  Lancement   produit  ')).toBe('Lancement produit');
  });

  it('tronque un titre trop long sans couper un mot', () => {
    const long =
      'Un titre particulièrement long qui dépasse largement la limite fixée pour rester lisible dans une notification';
    const result = shortTitle(long);
    expect(result.length).toBeLessThanOrEqual(81);
    expect(result.endsWith('…')).toBe(true);
    expect(result).not.toContain('  ');
  });

  it('annonce une publication réussie avec ses réseaux', () => {
    const message = publicationMessage('PUBLICATION_PUBLISHED', {
      title: 'Lancement',
      platforms: ['LinkedIn'],
    });
    expect(message.title).toBe('Publication envoyée');
    expect(message.body).toBe('« Lancement » est partie sur LinkedIn.');
    expect(message.url).toBe('#publishing');
  });

  it('accorde la liste des réseaux', () => {
    expect(
      publicationMessage('PUBLICATION_PUBLISHED', {
        title: 'T',
        platforms: ['LinkedIn', 'X'],
      }).body,
    ).toContain('sur LinkedIn et X');
    expect(
      publicationMessage('PUBLICATION_PUBLISHED', {
        title: 'T',
        platforms: ['LinkedIn', 'X', 'Instagram'],
      }).body,
    ).toContain('sur LinkedIn, X et Instagram');
  });

  it('déduplique les réseaux répétés dans le message', () => {
    const body = publicationMessage('PUBLICATION_PUBLISHED', {
      title: 'T',
      platforms: ['LinkedIn', 'LinkedIn'],
    }).body;
    expect(body).toContain('sur LinkedIn.');
    expect(body).not.toContain('et LinkedIn');
  });

  it('reprend le motif réel d’un échec', () => {
    const message = publicationMessage('PUBLICATION_FAILED', {
      title: 'T',
      platforms: ['X'],
      error: 'Aucun adaptateur de publication n’est configuré',
    });
    expect(message.body).toContain('n’a pas pu partir sur X :');
    expect(message.body).toContain('Aucun adaptateur');
  });

  it('dit qu’un échec est sans motif plutôt que d’en inventer un', () => {
    const message = publicationMessage('PUBLICATION_FAILED', {
      title: 'T',
      platforms: ['X'],
      error: null,
    });
    expect(message.body).toContain('Le motif n’a pas été fourni par la plateforme');
  });

  it('reprend le motif d’un refus, et dit quand il est vide', () => {
    expect(
      publicationMessage('CONTENT_REJECTED', {
        title: 'T',
        platforms: ['X'],
        reason: 'Ton trop familier',
      }).body,
    ).toContain('a été refusé : Ton trop familier');
    expect(
      publicationMessage('CONTENT_REJECTED', { title: 'T', platforms: ['X'], reason: null }).body,
    ).toContain('Aucun motif n’a été saisi');
  });

  it('rédige une demande de validation et une approbation', () => {
    expect(
      publicationMessage('APPROVAL_REQUESTED', { title: 'T', platforms: ['LinkedIn'] }).body,
    ).toContain('attend une décision');
    expect(
      publicationMessage('CONTENT_APPROVED', { title: 'T', platforms: ['LinkedIn'] }).body,
    ).toContain('peut être programmé');
  });

  it('refuse de rédiger un message pour un type hors publication', () => {
    expect(() => publicationMessage('VIDEO_READY', { title: 'T', platforms: ['X'] })).toThrow(
      /non lié à une publication/,
    );
  });

  it('décrit une connexion tombée avec son motif', () => {
    const message = socialExpiredMessage({
      platformLabel: 'LinkedIn',
      username: 'nova',
      error: 'Jeton expiré',
    });
    expect(message.title).toBe('Connexion LinkedIn à rétablir');
    expect(message.body).toContain('@nova');
    expect(message.body).toContain('Jeton expiré');
    expect(message.url).toBe('#social');
  });

  it('invite à reconnecter quand le motif manque', () => {
    const message = socialExpiredMessage({ platformLabel: 'X', username: 'nova', error: null });
    expect(message.body).toContain('Reconnectez le compte');
  });

  it('compose un e-mail avec sujet et rappel des préférences', () => {
    const draft = mailBody(
      { title: 'Publication envoyée', body: 'Corps', url: null },
      'PUBLICATION_PUBLISHED',
    );
    expect(draft.subject).toBe('[AI Social Studio] Publication envoyée');
    expect(draft.text).toContain('Corps');
    expect(draft.text).toContain(notificationTypeLabels.PUBLICATION_PUBLISHED);
    expect(draft.text).toContain('Préférences');
  });
});

// --- Déduplication ---

describe('clés de déduplication', () => {
  it('ne dépend pas de l’horodatage : deux échecs se cumulent', () => {
    expect(dedupeKeyFor('publication', 'pub-1', 'failed')).toBe('publication:pub-1:failed');
    expect(dedupeKeyFor('publication', 'pub-1', 'failed')).toBe(
      dedupeKeyFor('publication', 'pub-1', 'failed'),
    );
  });

  it('distingue les événements d’une même entité', () => {
    const published = publicationDedupeKey('pub-1', 'PUBLICATION_PUBLISHED');
    const failed = publicationDedupeKey('pub-1', 'PUBLICATION_FAILED');
    expect(published).not.toBe(failed);
  });

  it('renvoie null pour un type qui ne concerne pas une publication', () => {
    expect(publicationDedupeKey('pub-1', 'VIDEO_READY')).toBeNull();
  });
});

// --- Catalogue ---

describe('catalogue du §15', () => {
  it('couvre les dix événements demandés', () => {
    expect(notificationCatalog).toHaveLength(10);
    expect(new Set(notificationCatalog.map((entry) => entry.type)).size).toBe(10);
    expect(notificationCatalog.map((entry) => entry.type).sort()).toEqual(
      [...notificationTypes].sort(),
    );
  });

  it('déclare branchés exactement les événements réellement émis', () => {
    expect(wiredNotificationTypes.sort()).toEqual(
      [
        'APPROVAL_REQUESTED',
        'CONTENT_APPROVED',
        'CONTENT_REJECTED',
        'PUBLICATION_FAILED',
        'PUBLICATION_PUBLISHED',
        'SOCIAL_CONNECTION_EXPIRED',
      ].sort(),
    );
  });

  it('donne un motif à chaque événement non branché', () => {
    const unwired = notificationCatalog.filter((entry) => !entry.wired);
    expect(unwired).toHaveLength(4);
    for (const entry of unwired) {
      expect(entry.reason).toBeTruthy();
      expect((entry.reason ?? '').length).toBeGreaterThan(40);
    }
  });

  it('nomme le sous-système manquant dans chaque motif', () => {
    expect(catalogEntry('VIDEO_READY').reason).toMatch(/ffmpeg/);
    expect(catalogEntry('EXPORT_READY').reason).toMatch(/synchrone/);
    expect(catalogEntry('CREDITS_LOW').reason).toMatch(/crédits/);
    expect(catalogEntry('PAYMENT_FAILED').reason).toMatch(/paiement/);
  });

  it('n’attache aucun motif à un événement branché', () => {
    for (const entry of notificationCatalog.filter((item) => item.wired)) {
      expect(entry.reason).toBeNull();
    }
  });
});

// --- Préférences ---

describe('préférences', () => {
  it('active l’interne et laisse l’e-mail coupé par défaut', () => {
    expect(defaultPreference).toEqual({ inApp: true, email: false });
  });

  it('complète les types absents avec les valeurs par défaut', () => {
    const resolved = resolvePreferences([]);
    expect(resolved).toHaveLength(notificationTypes.length);
    expect(resolved.every((entry) => entry.inApp === true && entry.email === false)).toBe(true);
    expect(resolved.every((entry) => entry.customized === false)).toBe(true);
  });

  it('respecte les réglages enregistrés et marque ceux qui sont personnalisés', () => {
    const resolved = resolvePreferences([
      { type: 'PUBLICATION_FAILED', inApp: false, email: true },
    ]);
    const failed = resolved.find((entry) => entry.type === 'PUBLICATION_FAILED');
    expect(failed).toEqual({
      type: 'PUBLICATION_FAILED',
      inApp: false,
      email: true,
      customized: true,
    });
    const other = resolved.find((entry) => entry.type === 'PUBLICATION_PUBLISHED');
    expect(other?.customized).toBe(false);
  });

  it('formate un compteur d’occurrences', () => {
    expect(occurrencesLabel(1)).toBeNull();
    expect(occurrencesLabel(3)).toBe('3 fois');
  });

  it('plafonne la pastille de compteur', () => {
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(5)).toBe('5');
    expect(badgeLabel(150)).toBe('99+');
  });
});

// --- Service ---

interface FakeNotification {
  id: string;
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  url: string | null;
  entityType: string | null;
  entityId: string | null;
  dedupeKey: string | null;
  occurrences: number;
  inApp: boolean;
  readAt: Date | null;
  createdAt: Date;
  lastOccurredAt: Date;
  emailStatus: string;
  emailError: string | null;
}

function makeDb(options: { failCreate?: boolean } = {}) {
  const notifications: FakeNotification[] = [];
  const preferences: {
    organizationId: string;
    userId: string;
    type: NotificationType;
    inApp: boolean;
    email: boolean;
  }[] = [];
  const users = [
    { id: 'u-author', email: 'auteur@exemple.test' },
    { id: 'u-admin', email: 'admin@exemple.test' },
    { id: 'u-editor', email: 'editeur@exemple.test' },
  ];
  const members = [
    { userId: 'u-author', organizationId: 'org-1', role: 'EDITOR' },
    { userId: 'u-admin', organizationId: 'org-1', role: 'ADMIN' },
    { userId: 'u-editor', organizationId: 'org-1', role: 'EDITOR' },
  ];
  const publications = [
    {
      id: 'pub-1',
      organizationId: 'org-1',
      title: 'Lancement',
      createdById: 'u-author',
      lastError: 'Adaptateur absent',
      rejectionReason: null as string | null,
      targets: [{ platform: 'LINKEDIN' }, { platform: 'X' }],
    },
  ];
  const accounts = [
    {
      id: 'acc-1',
      organizationId: 'org-1',
      username: 'nova',
      platform: 'LINKEDIN',
      deletedAt: null,
    },
  ];

  let sequence = 0;
  const nextId = () => `n-${(sequence += 1)}`;

  /** Appariement minimal des `where` utilisés par le service. */
  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, expected]) => {
      if (expected === undefined) return true;
      if (key === 'role' && typeof expected === 'object' && expected !== null && 'in' in expected) {
        return (expected as { in: string[] }).in.includes(String(row.role));
      }
      if (expected === null) return row[key] === null;
      return row[key] === expected;
    });
  }

  const client = {
    notification: {
      async findFirst({ where, select }: { where: Record<string, unknown>; select?: unknown }) {
        const row = notifications.find((item) => matches(item as never, where));
        if (!row) return null;
        return select ? { id: row.id, occurrences: row.occurrences } : row;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        if (options.failCreate) throw new Error('base indisponible');
        const now = new Date();
        const row: FakeNotification = {
          id: nextId(),
          organizationId: String(data.organizationId),
          userId: String(data.userId),
          type: data.type as NotificationType,
          title: String(data.title),
          body: String(data.body),
          url: (data.url as string | null) ?? null,
          entityType: (data.entityType as string | null) ?? null,
          entityId: (data.entityId as string | null) ?? null,
          dedupeKey: (data.dedupeKey as string | null) ?? null,
          occurrences: 1,
          inApp: data.inApp !== false,
          readAt: null,
          createdAt: now,
          lastOccurredAt: now,
          emailStatus: 'NOT_REQUESTED',
          emailError: null,
        };
        notifications.push(row);
        return { id: row.id, occurrences: row.occurrences };
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const row = notifications.find((item) => item.id === where.id);
        if (!row) throw new Error('notification introuvable');
        const target = row as unknown as Record<string, unknown>;
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === 'object' && 'increment' in value) {
            target[key] = Number(target[key] ?? 0) + (value as { increment: number }).increment;
            continue;
          }
          target[key] = value;
        }
        return { id: row.id, occurrences: row.occurrences };
      },
      async count({ where }: { where: Record<string, unknown> }) {
        return notifications.filter((item) => matches(item as never, where)).length;
      },
      async findMany({ where, take }: { where: Record<string, unknown>; take?: number }) {
        const rows = notifications.filter((item) => matches(item as never, where));
        rows.sort((a, b) => b.lastOccurredAt.getTime() - a.lastOccurredAt.getTime());
        return take ? rows.slice(0, take) : rows;
      },
      async findFirstOrThrow({ where }: { where: Record<string, unknown> }) {
        const row = notifications.find((item) => matches(item as never, where));
        if (!row) throw new Error('notification introuvable');
        return row;
      },
      async updateMany({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) {
        const rows = notifications.filter((item) => matches(item as never, where));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
      async deleteMany({ where }: { where: Record<string, unknown> }) {
        const keep = notifications.filter((item) => !matches(item as never, where));
        const removed = notifications.length - keep.length;
        notifications.length = 0;
        notifications.push(...keep);
        return { count: removed };
      },
    },
    notificationPreference: {
      async findUnique({
        where,
      }: {
        where: { organizationId_userId_type: Record<string, string> };
      }) {
        const key = where.organizationId_userId_type;
        return (
          preferences.find(
            (item) =>
              item.organizationId === key.organizationId &&
              item.userId === key.userId &&
              item.type === key.type,
          ) ?? null
        );
      },
      async findMany({ where }: { where: Record<string, unknown> }) {
        return preferences.filter((item) => matches(item as never, where));
      },
      async upsert({
        where,
        create,
        update,
      }: {
        where: { organizationId_userId_type: Record<string, string> };
        create: Record<string, string | boolean>;
        update: Record<string, boolean>;
      }) {
        const key = where.organizationId_userId_type;
        const existing = preferences.find(
          (item) =>
            item.organizationId === key.organizationId &&
            item.userId === key.userId &&
            item.type === key.type,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = create as unknown as (typeof preferences)[number];
        preferences.push(row);
        return row;
      },
    },
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        return users.find((user) => user.id === where.id) ?? null;
      },
    },
    member: {
      async findMany({ where }: { where: Record<string, unknown> }) {
        return members
          .filter((item) => matches(item as never, where))
          .map((item) => ({
            userId: item.userId,
          }));
      },
      async findUnique({ where }: { where: { userId_organizationId: Record<string, string> } }) {
        const key = where.userId_organizationId;
        const found = members.find(
          (item) => item.userId === key.userId && item.organizationId === key.organizationId,
        );
        return found ? { userId: found.userId } : null;
      },
    },
    publication: {
      async findFirst({ where }: { where: Record<string, unknown> }) {
        const found = publications.find((item) => matches(item as never, where));
        return found ?? null;
      },
    },
    socialAccount: {
      async findFirst({ where }: { where: Record<string, unknown> }) {
        return accounts.find((item) => matches(item as never, where)) ?? null;
      },
    },
  };

  return { db: { client } as unknown as Db, notifications, preferences };
}

const failingTransport: MailTransport = {
  kind: 'API',
  async send() {
    return { ok: false, code: 'TRANSPORT_ERROR', message: 'Serveur SMTP injoignable' };
  },
  describe() {
    return { available: true, reason: null };
  },
};

/** Transport factice : il envoie vraiment (dans un tableau) et réussit. */
const sentMessages: { to: string; subject: string; text: string }[] = [];

const workingTransport: MailTransport = {
  kind: 'API',
  async send(message) {
    sentMessages.push(message);
    return { ok: true };
  },
  describe() {
    return { available: true, reason: null };
  },
};

describe('NotificationsService', () => {
  it('n’envoie jamais de notification à l’auteur de l’action', async () => {
    const { db, notifications } = makeDb();
    const service = new NotificationsService(db);
    const outcomes = await service.notify({
      organizationId: 'org-1',
      recipients: ['u-author', 'u-admin'],
      type: 'PUBLICATION_PUBLISHED',
      message: { title: 'T', body: 'B', url: null },
      actorId: 'u-author',
    });

    expect(outcomes.find((item) => item.userId === 'u-author')?.skipped).toBe('SELF');
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.userId).toBe('u-admin');
  });

  it('cumule deux événements de même clé au lieu de dupliquer', async () => {
    const { db, notifications } = makeDb();
    const service = new NotificationsService(db);
    const input = {
      organizationId: 'org-1',
      recipients: ['u-admin'],
      type: 'PUBLICATION_FAILED' as const,
      message: { title: 'Échec', body: 'B', url: null },
      dedupeKey: 'publication:pub-1:failed',
    };

    const first = await service.notify(input);
    expect(first[0]?.deduped).toBe(false);

    const second = await service.notify(input);
    expect(second[0]?.deduped).toBe(true);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.occurrences).toBe(2);
  });

  it('remet une notification cumulée en non-lue', async () => {
    const { db, notifications } = makeDb();
    const service = new NotificationsService(db);
    const input = {
      organizationId: 'org-1',
      recipients: ['u-admin'],
      type: 'PUBLICATION_FAILED' as const,
      message: { title: 'Échec', body: 'B', url: null },
      dedupeKey: 'publication:pub-1:failed',
    };
    await service.notify(input);
    notifications[0]!.readAt = new Date();

    await service.notify(input);
    expect(notifications[0]?.readAt).toBeNull();
  });

  it('respecte une préférence coupée sur les deux canaux', async () => {
    const { db, notifications } = makeDb();
    const service = new NotificationsService(db);
    await service.updatePreferences('org-1', 'u-admin', {
      preferences: [{ type: 'PUBLICATION_FAILED', inApp: false, email: false }],
    });

    const outcomes = await service.notify({
      organizationId: 'org-1',
      recipients: ['u-admin'],
      type: 'PUBLICATION_FAILED',
      message: { title: 'T', body: 'B', url: null },
    });

    expect(outcomes[0]?.skipped).toBe('PREFERENCE_OFF');
    expect(notifications).toHaveLength(0);
  });

  it('enregistre la ligne hors boîte quand seul l’e-mail est demandé', async () => {
    const { db, notifications } = makeDb();
    const service = new NotificationsService(db);
    await service.updatePreferences('org-1', 'u-admin', {
      preferences: [{ type: 'PUBLICATION_FAILED', inApp: false, email: true }],
    });

    const outcomes = await service.notify({
      organizationId: 'org-1',
      recipients: ['u-admin'],
      type: 'PUBLICATION_FAILED',
      message: { title: 'T', body: 'B', url: null },
    });

    expect(outcomes[0]?.recorded).toBe(true);
    expect(notifications[0]?.inApp).toBe(false);
  });

  it('déclare NO_PROVIDER plutôt que d’inventer un envoi', async () => {
    const { db, notifications } = makeDb();
    const service = new NotificationsService(db);
    await service.updatePreferences('org-1', 'u-admin', {
      preferences: [{ type: 'PUBLICATION_FAILED', email: true }],
    });

    const outcomes = await service.notify({
      organizationId: 'org-1',
      recipients: ['u-admin'],
      type: 'PUBLICATION_FAILED',
      message: { title: 'T', body: 'B', url: null },
    });

    expect(outcomes[0]?.emailStatus).toBe('NO_PROVIDER');
    expect(outcomes[0]?.emailError).toBe(NO_PROVIDER_REASON);
    expect(notifications[0]?.emailStatus).toBe('NO_PROVIDER');
    expect(notifications[0]?.emailError).toContain('Aucun transport e-mail');
  });

  it('marque SENT quand un transport réel est fourni', async () => {
    const { db, notifications } = makeDb();
    const service = new NotificationsService(db, workingTransport);
    await service.updatePreferences('org-1', 'u-admin', {
      preferences: [{ type: 'PUBLICATION_FAILED', email: true }],
    });

    const outcomes = await service.notify({
      organizationId: 'org-1',
      recipients: ['u-admin'],
      type: 'PUBLICATION_FAILED',
      message: { title: 'T', body: 'B', url: null },
    });

    expect(outcomes[0]?.emailStatus).toBe('SENT');
    expect(notifications[0]?.emailStatus).toBe('SENT');
    expect(sentMessages.at(-1)?.to).toBe('admin@exemple.test');
    expect(sentMessages.at(-1)?.subject).toContain('AI Social Studio');
  });

  it('marque FAILED quand le transport échoue, avec son message', async () => {
    const { db, notifications } = makeDb();
    const service = new NotificationsService(db, failingTransport);
    await service.updatePreferences('org-1', 'u-admin', {
      preferences: [{ type: 'PUBLICATION_FAILED', email: true }],
    });

    const outcomes = await service.notify({
      organizationId: 'org-1',
      recipients: ['u-admin'],
      type: 'PUBLICATION_FAILED',
      message: { title: 'T', body: 'B', url: null },
    });

    expect(outcomes[0]?.emailStatus).toBe('FAILED');
    expect(outcomes[0]?.emailError).toBe('Serveur SMTP injoignable');
    expect(notifications[0]?.emailStatus).toBe('FAILED');
  });

  it('adresse une demande de validation aux responsables, pas à l’auteur', async () => {
    const { db, notifications } = makeDb();
    const service = new NotificationsService(db);

    await service.notifyPublication('org-1', 'pub-1', 'APPROVAL_REQUESTED', {
      actorId: 'u-editor',
    });

    expect(notifications.map((row) => row.userId)).toEqual(['u-admin']);
    expect(notifications[0]?.body).toContain('attend une décision');
    expect(notifications[0]?.body).toContain('LinkedIn et X');
    expect(notifications[0]?.dedupeKey).toBe('publication:pub-1:approval');
  });

  it('adresse un échec de publication à son auteur, avec le motif', async () => {
    const { db, notifications } = makeDb();
    const service = new NotificationsService(db);

    await service.notifyPublication('org-1', 'pub-1', 'PUBLICATION_FAILED');

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.userId).toBe('u-author');
    expect(notifications[0]?.body).toContain('Adaptateur absent');
    expect(notifications[0]?.entityType).toBe('publication');
    expect(notifications[0]?.entityId).toBe('pub-1');
  });

  it('prévient les responsables quand une connexion sociale tombe', async () => {
    const { db, notifications } = makeDb();
    const service = new NotificationsService(db);

    await service.notifySocialExpired('org-1', 'acc-1', 'Jeton révoqué');

    expect(notifications[0]?.type).toBe('SOCIAL_CONNECTION_EXPIRED');
    expect(notifications[0]?.userId).toBe('u-admin');
    expect(notifications[0]?.body).toContain('Jeton révoqué');
    expect(notifications[0]?.dedupeKey).toBe('social:acc-1:expired');
  });

  it('n’interrompt jamais l’action appelante quand la base échoue', async () => {
    const { db } = makeDb({ failCreate: true });
    const service = new NotificationsService(db);

    await expect(
      service.notifyPublication('org-1', 'pub-1', 'PUBLICATION_PUBLISHED'),
    ).resolves.toBeUndefined();
    await expect(
      service.notifySocialExpired('org-1', 'acc-1', 'peu importe'),
    ).resolves.toBeUndefined();
  });

  it('ignore une entité inexistante sans lever', async () => {
    const { db, notifications } = makeDb();
    const service = new NotificationsService(db);

    await service.notifyPublication('org-1', 'pub-inconnue', 'PUBLICATION_PUBLISHED');
    await service.notifySocialExpired('org-1', 'acc-inconnu', 'x');

    expect(notifications).toHaveLength(0);
  });

  it('ne lit et ne modifie que ses propres notifications', async () => {
    const { db, notifications } = makeDb();
    const service = new NotificationsService(db);
    await service.notify({
      organizationId: 'org-1',
      recipients: ['u-admin'],
      type: 'PUBLICATION_PUBLISHED',
      message: { title: 'T', body: 'B', url: null },
    });
    const id = notifications[0]!.id;

    await expect(service.markRead('org-1', 'u-editor', id)).rejects.toThrow(/introuvable/);
    await expect(service.remove('org-1', 'u-editor', id)).rejects.toThrow(/introuvable/);
    await expect(service.markRead('org-1', 'u-admin', id)).resolves.toMatchObject({ id });
  });

  it('compte les non-lues et les marque toutes lues', async () => {
    const { db } = makeDb();
    const service = new NotificationsService(db);
    await service.notify({
      organizationId: 'org-1',
      recipients: ['u-admin'],
      type: 'PUBLICATION_PUBLISHED',
      message: { title: 'A', body: 'B', url: null },
    });
    await service.notify({
      organizationId: 'org-1',
      recipients: ['u-admin'],
      type: 'PUBLICATION_FAILED',
      message: { title: 'C', body: 'D', url: null },
    });

    expect((await service.unreadCount('org-1', 'u-admin')).unread).toBe(2);
    expect(await service.markAllRead('org-1', 'u-admin')).toEqual({ unread: 0 });
    expect((await service.unreadCount('org-1', 'u-admin')).unread).toBe(0);
  });

  it('exclut de la boîte les lignes dont le canal interne est coupé', async () => {
    const { db } = makeDb();
    const service = new NotificationsService(db);
    await service.updatePreferences('org-1', 'u-admin', {
      preferences: [{ type: 'PUBLICATION_FAILED', inApp: false, email: true }],
    });
    await service.notify({
      organizationId: 'org-1',
      recipients: ['u-admin'],
      type: 'PUBLICATION_FAILED',
      message: { title: 'T', body: 'B', url: null },
    });

    const list = await service.list('org-1', 'u-admin', { unread: undefined, limit: 30 });
    expect(list.total).toBe(0);
    expect(list.unread).toBe(0);
  });

  it('ne fige pas une préférence que l’utilisateur n’a jamais exprimée', async () => {
    const { db, preferences } = makeDb();
    const service = new NotificationsService(db);

    await service.updatePreferences('org-1', 'u-admin', {
      preferences: [{ type: 'PUBLICATION_FAILED', email: true }],
    });

    expect(preferences).toHaveLength(1);
    expect(preferences[0]).toMatchObject({ inApp: true, email: true });

    const resolved = await service.preferences('org-1', 'u-admin');
    expect(resolved.find((entry) => entry.type === 'PUBLICATION_FAILED')?.customized).toBe(true);
    expect(resolved.find((entry) => entry.type === 'CREDITS_LOW')?.customized).toBe(false);
  });

  it('décrit le canal e-mail tel qu’il est, sans le maquiller', () => {
    const { db } = makeDb();
    const service = new NotificationsService(db);

    expect(service.channels().email).toEqual({
      available: false,
      reason: NO_PROVIDER_REASON,
    });
    expect(service.catalog().events).toHaveLength(10);
    expect(service.catalog().email.available).toBe(false);
  });

  it('reflète un transport configuré quand il y en a un', () => {
    const { db } = makeDb();
    const service = new NotificationsService(db, workingTransport);
    expect(service.channels().email).toEqual({ available: true, reason: null });
  });

  it('expose le transport inerte comme valeur par défaut', async () => {
    const result = await noopMailTransport.send({ to: 'x', subject: 's', text: 't' });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ code: 'NO_PROVIDER' });
    expect(noopMailTransport.describe().available).toBe(false);
  });
});
