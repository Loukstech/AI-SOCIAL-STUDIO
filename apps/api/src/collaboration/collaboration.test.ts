import { describe, expect, it } from 'vitest';
import {
  countOpen,
  filterVisible,
  groupThreads,
  isOverdue,
  sortTasks,
  type Comment,
  type OrganizationRole,
  type Task,
} from '@ass/shared';
import type { Db } from '../common/validation.js';
import { CommentsService } from './comments.service.js';
import { HistoryService } from './history.service.js';
import { PortfolioService } from './portfolio.service.js';
import { TasksService } from './tasks.service.js';

/**
 * Ces tests protègent la contrainte centrale du §14 :
 *
 * > « Un client doit pouvoir approuver ou refuser les contenus qui le concernent
 * > sans accéder aux autres clients ni aux paramètres internes de l'agence. »
 *
 * Autrement dit : la visibilité est une règle de lecture, pas un filtre
 * d'affichage. Les cas ci-dessous vérifient que la ligne interne ne sort jamais
 * de la base pour un client, que l'historique ne laisse pas fuir ce que le fil
 * cache, et que les compteurs du portefeuille ne comptent que le visible.
 */

// --- Outils de base ---

type Row = Record<string, unknown>;

/** Appariement minimal mais fidèle des `where` réellement utilisés. */
function match(row: Row, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true;
  return Object.entries(where as Row).every(([key, expected]) => {
    if (expected === undefined) return true;
    if (key === 'OR') return (expected as unknown[]).some((sub) => match(row, sub));
    const value = row[key];
    if (expected === null) return value === null || value === undefined;
    if (expected instanceof Date) {
      return value instanceof Date && value.getTime() === expected.getTime();
    }
    if (typeof expected === 'object') {
      const spec = expected as Row;
      if ('in' in spec) return (spec.in as unknown[]).includes(value);
      if ('notIn' in spec) return !(spec.notIn as unknown[]).includes(value);
      // Filtre de relation : la ligne porte l'objet joint.
      return value !== null && typeof value === 'object' && match(value as Row, spec);
    }
    return value === expected;
  });
}

function order(rows: Row[], orderBy: unknown): Row[] {
  const spec = Array.isArray(orderBy) ? orderBy[0] : orderBy;
  if (!spec || typeof spec !== 'object') return rows;
  const entry = Object.entries(spec as Row)[0];
  if (!entry) return rows;
  const [key, direction] = entry;
  if (typeof direction !== 'string') return rows;
  return [...rows].sort((a, b) => {
    const av = a[key] instanceof Date ? (a[key] as Date).getTime() : a[key];
    const bv = b[key] instanceof Date ? (b[key] as Date).getTime() : b[key];
    if (av === bv) return 0;
    const comparison = (av as number) > (bv as number) ? 1 : -1;
    return direction === 'desc' ? -comparison : comparison;
  });
}

function table(rows: Row[], decorate: (row: Row) => Row = (row) => row) {
  let sequence = 0;
  const store = rows.map((row) => ({ ...row }));
  const view = (row: Row) => decorate(row);

  return {
    store,
    async findMany(args: Row = {}) {
      let result = store.filter((row) => match(view(row), args.where));
      result = order(result, args.orderBy);
      if (typeof args.take === 'number') result = result.slice(0, args.take);
      return result.map(view);
    },
    async findFirst(args: Row = {}) {
      const result = order(
        store.filter((row) => match(view(row), args.where)),
        args.orderBy,
      );
      return result.length > 0 ? view(result[0]!) : null;
    },
    async count(args: Row = {}) {
      return store.filter((row) => match(view(row), args.where)).length;
    },
    async create(args: Row) {
      const now = new Date();
      const row: Row = {
        id: `new-${(sequence += 1)}`,
        createdAt: now,
        updatedAt: now,
        ...(args.data as Row),
      };
      store.push(row);
      return view(row);
    },
    async update(args: Row) {
      const where = args.where as Row;
      const row = store.find((item) => item.id === where.id);
      if (!row) throw new Error('ligne introuvable');
      Object.assign(row, args.data as Row, { updatedAt: new Date() });
      return view(row);
    },
    async delete(args: Row) {
      const where = args.where as Row;
      const index = store.findIndex((item) => item.id === where.id);
      if (index >= 0) store.splice(index, 1);
      return {};
    },
  };
}

// --- Jeu de données ---

const T0 = '2026-01-01T09:00:00.000Z';
const T1 = '2026-01-02T09:00:00.000Z';
const T1B = '2026-01-02T12:00:00.000Z';
const T1C = '2026-01-02T15:00:00.000Z';
const T2 = '2026-01-03T09:00:00.000Z';
const T3 = '2026-01-04T09:00:00.000Z';
const T4 = '2026-01-05T09:00:00.000Z';
const PAST = '2020-01-01T09:00:00.000Z';

const USERS: Row[] = [
  { id: 'u-owner', name: 'Alice', email: 'alice@exemple.test' },
  { id: 'u-editor', name: 'Bruno', email: 'bruno@exemple.test' },
  { id: 'u-client', name: 'Chloé', email: 'chloe@exemple.test' },
  { id: 'u-viewer', name: 'David', email: 'david@exemple.test' },
  { id: 'u-other', name: 'Eve', email: 'eve@exemple.test' },
];

const ORGS: Row[] = [
  { id: 'org-1', name: 'Agence Nova', slug: 'nova', deletedAt: null },
  { id: 'org-2', name: 'Client Bêta', slug: 'beta', deletedAt: null },
  { id: 'org-3', name: 'Autre', slug: 'autre', deletedAt: null },
];

const MEMBERS: Row[] = [
  { userId: 'u-owner', organizationId: 'org-1', role: 'OWNER' },
  { userId: 'u-editor', organizationId: 'org-1', role: 'EDITOR' },
  { userId: 'u-client', organizationId: 'org-1', role: 'CLIENT' },
  { userId: 'u-viewer', organizationId: 'org-1', role: 'VIEWER' },
  { userId: 'u-owner', organizationId: 'org-2', role: 'ADMIN' },
  { userId: 'u-other', organizationId: 'org-3', role: 'OWNER' },
];

const PUBLICATIONS: Row[] = [
  { id: 'pub-1', organizationId: 'org-1', title: 'Lancement', status: 'APPROVED', deletedAt: null },
  { id: 'pub-2', organizationId: 'org-1', title: 'Brouillon', status: 'DRAFT', deletedAt: null },
  {
    id: 'pub-3',
    organizationId: 'org-1',
    title: 'À valider',
    status: 'PENDING_APPROVAL',
    deletedAt: null,
  },
  {
    id: 'pub-9',
    organizationId: 'org-3',
    title: 'Chez un autre',
    status: 'DRAFT',
    deletedAt: null,
  },
];

const TARGETS: Row[] = [{ id: 'tgt-1', publicationId: 'pub-1', platform: 'LINKEDIN' }];

const EVENTS: Row[] = [
  {
    id: 'ev-1',
    publicationId: 'pub-1',
    fromStatus: null,
    toStatus: 'DRAFT',
    actorId: 'u-editor',
    reason: null,
    createdAt: new Date(T0),
  },
  {
    id: 'ev-2',
    publicationId: 'pub-1',
    fromStatus: 'DRAFT',
    toStatus: 'PENDING_APPROVAL',
    actorId: 'u-editor',
    reason: null,
    createdAt: new Date(T1),
  },
  {
    id: 'ev-3',
    publicationId: 'pub-1',
    fromStatus: 'PENDING_APPROVAL',
    toStatus: 'REJECTED',
    actorId: 'u-client',
    reason: 'Le logo est l’ancien',
    createdAt: new Date(T2),
  },
];

const AUDITS: Row[] = [
  {
    id: 'au-1',
    organizationId: 'org-1',
    actorId: 'u-editor',
    action: 'publication.created',
    targetType: 'publication',
    targetId: 'pub-1',
    metadata: null,
    createdAt: new Date(T0),
  },
  {
    id: 'au-2',
    organizationId: 'org-1',
    actorId: 'u-editor',
    action: 'analytics.metric_recorded',
    targetType: 'publication_target',
    targetId: 'tgt-1',
    metadata: { platform: 'LINKEDIN' },
    createdAt: new Date(T3),
  },
  {
    id: 'au-3',
    organizationId: 'org-1',
    actorId: null,
    action: 'publication.archived_by_cron',
    targetType: 'publication',
    targetId: 'pub-1',
    metadata: null,
    createdAt: new Date(T4),
  },
];

const COMMENTS: Row[] = [
  {
    id: 'co-1',
    organizationId: 'org-1',
    entityType: 'publication',
    entityId: 'pub-1',
    authorId: 'u-editor',
    authorName: 'Bruno',
    body: 'Note interne : ne pas publier avant le 15.',
    visibility: 'INTERNAL',
    parentId: null,
    resolvedAt: null,
    resolvedById: null,
    createdAt: new Date(T1),
    updatedAt: new Date(T1),
    deletedAt: null,
  },
  {
    id: 'co-2',
    organizationId: 'org-1',
    entityType: 'publication',
    entityId: 'pub-1',
    authorId: 'u-client',
    authorName: 'Chloé',
    body: 'Le logo est l’ancien, pouvez-vous le changer ?',
    visibility: 'CLIENT',
    parentId: null,
    resolvedAt: null,
    resolvedById: null,
    createdAt: new Date(T1B),
    updatedAt: new Date(T1B),
    deletedAt: null,
  },
  {
    id: 'co-3',
    organizationId: 'org-1',
    entityType: 'publication',
    entityId: 'pub-1',
    authorId: 'u-editor',
    authorName: 'Bruno',
    body: 'Corrigé, nouvelle version en ligne.',
    visibility: 'CLIENT',
    parentId: 'co-2',
    resolvedAt: null,
    resolvedById: null,
    createdAt: new Date(T1C),
    updatedAt: new Date(T1C),
    deletedAt: null,
  },
];

const TASKS: Row[] = [
  {
    id: 'ta-1',
    organizationId: 'org-1',
    entityType: 'publication',
    entityId: 'pub-1',
    title: 'Préparer les visuels',
    description: null,
    status: 'OPEN',
    assigneeId: 'u-editor',
    assigneeName: 'Bruno',
    createdById: 'u-owner',
    createdByName: 'Alice',
    dueAt: new Date(PAST),
    completedAt: null,
    createdAt: new Date(T0),
    updatedAt: new Date(T0),
  },
  {
    id: 'ta-2',
    organizationId: 'org-1',
    entityType: 'publication',
    entityId: 'pub-1',
    title: 'Relire la copie',
    description: null,
    status: 'DONE',
    assigneeId: 'u-editor',
    assigneeName: 'Bruno',
    createdById: 'u-owner',
    createdByName: 'Alice',
    dueAt: null,
    completedAt: new Date(T2),
    createdAt: new Date(T0),
    updatedAt: new Date(T2),
  },
  {
    id: 'ta-3',
    organizationId: 'org-1',
    entityType: null,
    entityId: null,
    title: 'Facturer janvier',
    description: null,
    status: 'OPEN',
    assigneeId: null,
    assigneeName: null,
    createdById: 'u-owner',
    createdByName: 'Alice',
    dueAt: null,
    completedAt: null,
    createdAt: new Date(T0),
    updatedAt: new Date(T0),
  },
];

function makeDb(): Db {
  const publications = table(PUBLICATIONS);
  const targets = table(TARGETS);
  const events = table(EVENTS, (row) => ({ ...row, publication: { organizationId: 'org-1' } }));
  const audits = table(AUDITS);
  const comments = table(COMMENTS, (row) => ({
    ...row,
    // Le service lit `author.name` : on résout par `authorId`, comme la vraie
    // relation, pour que la création d'un commentaire soit couverte aussi.
    author: { name: USERS.find((user) => user.id === row.authorId)?.name ?? 'Inconnu' },
  }));
  const tasks = table(TASKS, (row) => ({
    ...row,
    assignee: row.assigneeName ? { name: row.assigneeName } : null,
    createdBy: row.createdByName ? { name: row.createdByName } : null,
  }));
  const users = table(USERS);
  const members = table(MEMBERS, (row) => ({
    ...row,
    organization: ORGS.find((org) => org.id === row.organizationId),
  }));

  const client = {
    publication: publications,
    publicationTarget: targets,
    publicationEvent: events,
    auditLog: audits,
    comment: comments,
    task: tasks,
    user: users,
    member: {
      ...members,
      async findUnique(args: {
        where: { userId_organizationId: { userId: string; organizationId: string } };
      }) {
        const { userId, organizationId } = args.where.userId_organizationId;
        return (
          MEMBERS.find((row) => row.userId === userId && row.organizationId === organizationId) ??
          null
        );
      },
    },
  };

  return { client } as unknown as Db;
}

const commentsService = () => new CommentsService(makeDb());
const tasksService = () => new TasksService(makeDb());
const historyService = () => new HistoryService(makeDb());
const portfolioService = () => new PortfolioService(makeDb());

const actor = (userId: string, role: OrganizationRole) => ({ userId, role });

// --- Règles pures partagées ---

describe('règles de collaboration (partagées)', () => {
  it('ne montre au client que ce qui est marqué CLIENT', () => {
    const items = [
      { id: 'a', visibility: 'INTERNAL' as const },
      { id: 'b', visibility: 'CLIENT' as const },
    ];
    expect(filterVisible('CLIENT', items).map((item) => item.id)).toEqual(['b']);
    expect(filterVisible('EDITOR', items)).toHaveLength(2);
    expect(filterVisible('VIEWER', items)).toHaveLength(2);
  });

  it('traite une réponse orpheline comme une racine plutôt que de la perdre', () => {
    const comments = [
      { id: 'root', parentId: null },
      { id: 'reply', parentId: 'root' },
      { id: 'orphan', parentId: 'hidden' },
    ] as unknown as Comment[];
    const threads = groupThreads(comments);
    expect(threads.map((thread) => thread.root.id)).toEqual(['root', 'orphan']);
    expect(threads[0]!.replies.map((reply) => reply.id)).toEqual(['reply']);
  });

  it('compte les commentaires non résolus seulement', () => {
    expect(countOpen([{ resolvedAt: null }, { resolvedAt: T1 }])).toBe(1);
  });

  it('ne considère jamais une tâche terminée comme en retard', () => {
    const now = new Date('2026-01-10T00:00:00.000Z');
    expect(isOverdue({ status: 'OPEN', dueAt: PAST }, now)).toBe(true);
    expect(isOverdue({ status: 'DONE', dueAt: PAST }, now)).toBe(false);
    expect(isOverdue({ status: 'CANCELLED', dueAt: PAST }, now)).toBe(false);
    expect(isOverdue({ status: 'OPEN', dueAt: null }, now)).toBe(false);
  });

  it('classe les tâches en retard d’abord, puis par échéance', () => {
    const base = {
      description: null,
      assigneeId: null,
      assigneeName: null,
      createdById: null,
      createdByName: null,
      entityType: null,
      entityId: null,
      completedAt: null,
      createdAt: T0,
      updatedAt: T0,
    };
    const tasks = [
      {
        ...base,
        id: 'later',
        title: 'Plus tard',
        status: 'OPEN',
        dueAt: '2030-01-01T00:00:00.000Z',
      },
      { ...base, id: 'overdue', title: 'En retard', status: 'OPEN', dueAt: PAST },
      { ...base, id: 'soon', title: 'Bientôt', status: 'OPEN', dueAt: '2026-06-01T00:00:00.000Z' },
    ] as unknown as Task[];
    expect(sortTasks(tasks, new Date('2026-01-10T00:00:00.000Z')).map((task) => task.id)).toEqual([
      'overdue',
      'soon',
      'later',
    ]);
  });
});

// --- Commentaires ---

describe('commentaires', () => {
  it('ne renvoie jamais une ligne interne à un client', async () => {
    const result = await commentsService().list('org-1', 'CLIENT', 'publication', 'pub-1');
    expect(result.comments.map((comment) => comment.id)).toEqual(['co-2', 'co-3']);
    expect(result.comments.every((comment) => comment.visibility === 'CLIENT')).toBe(true);
    // Le total reflète ce qui a été renvoyé, jamais le nombre réel en base.
    expect(result.total).toBe(2);
  });

  it('renvoie tout à un éditeur, y compris les notes internes', async () => {
    const result = await commentsService().list('org-1', 'EDITOR', 'publication', 'pub-1');
    expect(result.comments).toHaveLength(3);
    expect(result.open).toBe(3);
  });

  it('force la visibilité CLIENT pour un commentaire déposé par un client', async () => {
    const comment = await commentsService().create(
      'org-1',
      actor('u-client', 'CLIENT'),
      'publication',
      'pub-1',
      { body: 'Merci !', visibility: 'INTERNAL' },
    );
    // Un client ne peut pas créer de note interne, même en le demandant.
    expect(comment.visibility).toBe('CLIENT');
    expect(comment.authorName).toBe('Chloé');
  });

  it('fait hériter une réponse de la visibilité de son parent', async () => {
    const comment = await commentsService().create(
      'org-1',
      actor('u-editor', 'EDITOR'),
      'publication',
      'pub-1',
      { body: 'Bien reçu', visibility: 'INTERNAL', parentId: 'co-2' },
    );
    // Le parent est visible du client : la réponse doit l'être aussi, sinon le
    // fil se scinde en deux conversations.
    expect(comment.visibility).toBe('CLIENT');
  });

  it('refuse une réponse à un commentaire interne pour un client', async () => {
    await expect(
      commentsService().create('org-1', actor('u-client', 'CLIENT'), 'publication', 'pub-1', {
        body: 'Je réponds',
        visibility: 'CLIENT',
        parentId: 'co-1',
      }),
    ).rejects.toThrow('Commentaire parent introuvable');
  });

  it('limite l’imbrication à un niveau', async () => {
    await expect(
      commentsService().create('org-1', actor('u-editor', 'EDITOR'), 'publication', 'pub-1', {
        body: 'Réponse à une réponse',
        visibility: 'CLIENT',
        parentId: 'co-3',
      }),
    ).rejects.toThrow('un niveau');
  });

  it('réserve la modification du texte à son auteur', async () => {
    await expect(
      commentsService().update('org-1', actor('u-owner', 'OWNER'), 'co-2', { body: 'Réécrit' }),
    ).rejects.toThrow('Seul l’auteur');
  });

  it('autorise l’auteur à résoudre son propre commentaire', async () => {
    const comment = await commentsService().update('org-1', actor('u-client', 'CLIENT'), 'co-2', {
      resolved: true,
    });
    expect(comment.resolvedAt).not.toBeNull();
    expect(comment.resolvedByName).toBe('Chloé');
  });

  it('interdit à un lecteur de résoudre un fil', async () => {
    await expect(
      commentsService().update('org-1', actor('u-viewer', 'VIEWER'), 'co-2', { resolved: true }),
    ).rejects.toThrow('Résolution réservée');
  });

  it('supprime logiquement : le commentaire quitte la liste', async () => {
    const service = commentsService();
    await service.remove('org-1', actor('u-owner', 'OWNER'), 'co-1');
    const result = await service.list('org-1', 'EDITOR', 'publication', 'pub-1');
    expect(result.comments.map((comment) => comment.id)).toEqual(['co-2', 'co-3']);
  });

  it('refuse un type de contenu non commentable', async () => {
    await expect(commentsService().list('org-1', 'EDITOR', 'brand', 'pub-1')).rejects.toThrow(
      'non commentable',
    );
  });

  it('répond 404 hors périmètre de l’organisation', async () => {
    await expect(commentsService().list('org-3', 'OWNER', 'publication', 'pub-1')).rejects.toThrow(
      'Contenu introuvable',
    );
  });
});

// --- Tâches ---

describe('tâches', () => {
  it('refuse d’assigner à quelqu’un qui n’est pas membre', async () => {
    await expect(
      tasksService().create('org-1', 'u-owner', {
        title: 'Relire',
        assigneeId: 'u-other',
      }),
    ).rejects.toThrow('membre de cette organisation');
  });

  it('exige le type et l’identifiant ensemble', async () => {
    await expect(
      tasksService().create('org-1', 'u-owner', { title: 'Relire', entityType: 'publication' }),
    ).rejects.toThrow('vont ensemble');
  });

  it('date la tâche quand elle passe à DONE, et efface la date au retour', async () => {
    const service = tasksService();
    const done = await service.update('org-1', 'ta-1', { status: 'DONE' });
    expect(done.status).toBe('DONE');
    expect(done.completedAt).not.toBeNull();

    const reopened = await service.update('org-1', 'ta-1', { status: 'OPEN' });
    // Rouvrir ne peut pas laisser une date d'achèvement : ce serait un état
    // intermédiaire mensonger.
    expect(reopened.completedAt).toBeNull();
  });

  it('ne touche pas à la date d’achèvement si le statut ne change pas', async () => {
    const task = await tasksService().update('org-1', 'ta-2', { title: 'Relire deux fois' });
    expect(task.status).toBe('DONE');
    expect(task.completedAt).toBe(T2);
  });

  it('filtre par statut et par contenu', async () => {
    const service = tasksService();
    expect((await service.list('org-1', { status: 'OPEN' })).map((task) => task.id)).toEqual([
      'ta-1',
      'ta-3',
    ]);
    expect(
      (await service.list('org-1', { entityType: 'publication', entityId: 'pub-1' })).map(
        (task) => task.id,
      ),
    ).toEqual(['ta-1', 'ta-2']);
  });

  it('répond 404 pour une tâche d’une autre organisation', async () => {
    await expect(tasksService().remove('org-3', 'ta-1')).rejects.toThrow('Tâche introuvable');
  });
});

// --- Historique ---

describe('historique', () => {
  it('fusionne les quatre sources en une chronologie décroissante', async () => {
    const history = await historyService().forPublication('org-1', 'EDITOR', 'pub-1');
    const kinds = new Set(history.entries.map((entry) => entry.kind));
    expect(kinds).toEqual(new Set(['STATUS', 'AUDIT', 'COMMENT', 'TASK']));

    const dates = history.entries.map((entry) => Date.parse(entry.at));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    expect(history.truncated).toBe(0);
  });

  it('attribue un libellé lisible à une action connue', async () => {
    const history = await historyService().forPublication('org-1', 'EDITOR', 'pub-1');
    const created = history.entries.find((entry) => entry.id === 'audit:au-1');
    expect(created?.label).toBe('Bruno a créé le contenu');
    expect(created?.actorName).toBe('Bruno');
  });

  it('affiche une action inconnue avec son code plutôt que de la masquer', async () => {
    const history = await historyService().forPublication('org-1', 'EDITOR', 'pub-1');
    const unknown = history.entries.find((entry) => entry.id === 'audit:au-3');
    // Un trou dans un historique est pire qu'un libellé sec.
    expect(unknown?.label).toBe('Action « publication.archived_by_cron »');
    expect(unknown?.actorName).toBeNull();
  });

  it('fait remonter le motif d’un refus dans le détail', async () => {
    const history = await historyService().forPublication('org-1', 'EDITOR', 'pub-1');
    const rejected = history.entries.find((entry) => entry.id === 'event:ev-3');
    expect(rejected?.detail).toBe('Le logo est l’ancien');
    expect(rejected?.label).toContain('En attente de validation');
    expect(rejected?.label).toContain('Refusé');
  });

  it('inclut la saisie de mesures, journalisée contre la cible et non le contenu', async () => {
    const history = await historyService().forPublication('org-1', 'EDITOR', 'pub-1');
    const metrics = history.entries.find((entry) => entry.id === 'audit:au-2');
    expect(metrics?.label).toBe('Bruno a saisi des mesures');
    expect(metrics?.detail).toBe('LINKEDIN');
  });

  it('cache au client les commentaires internes de l’historique', async () => {
    const history = await historyService().forPublication('org-1', 'CLIENT', 'pub-1');
    const ids = history.entries.map((entry) => entry.id);
    expect(ids).toContain('comment:co-2');
    expect(ids).not.toContain('comment:co-1');
  });

  it('annonce le nombre d’entrées antérieures hors fenêtre', async () => {
    const history = await historyService().forPublication('org-1', 'EDITOR', 'pub-1', 3);
    expect(history.entries).toHaveLength(3);
    expect(history.truncated).toBeGreaterThan(0);
  });

  it('répond 404 pour un contenu d’une autre organisation', async () => {
    await expect(historyService().forPublication('org-3', 'OWNER', 'pub-1')).rejects.toThrow(
      'Contenu introuvable',
    );
  });
});

// --- Portefeuille ---

describe('portefeuille', () => {
  it('ne liste que les organisations où l’utilisateur est membre', async () => {
    const portfolio = await portfolioService().overview('u-owner');
    expect(portfolio.clients.map((client) => client.slug)).toEqual(['nova', 'beta']);
    expect(portfolio.clients.map((client) => client.role)).toEqual(['OWNER', 'ADMIN']);
  });

  it('additionne les compteurs sans inventer de chiffres', async () => {
    const portfolio = await portfolioService().overview('u-owner');
    expect(portfolio.totals).toEqual({
      clients: 2,
      publications: 3,
      pendingApprovals: 1,
      openTasks: 2,
      overdueTasks: 1,
    });
    // Une organisation sans activité renvoie `null`, jamais `0` ni une date
    // arbitraire : l'absence d'activité n'est pas une activité.
    const beta = portfolio.clients.find((client) => client.slug === 'beta');
    expect(beta?.lastActivityAt).toBeNull();
    expect(beta?.publications).toBe(0);
  });

  it('ne compte pour un client que les commentaires qu’il peut lire', async () => {
    const asClient = await portfolioService().overview('u-client');
    expect(asClient.clients).toHaveLength(1);
    // Trois commentaires en base, deux visibles par le client.
    expect(asClient.clients[0]!.openComments).toBe(2);

    const asOwner = await portfolioService().overview('u-owner');
    const nova = asOwner.clients.find((client) => client.slug === 'nova');
    expect(nova?.openComments).toBe(3);
  });

  it('date la dernière activité au plus récent des journaux', async () => {
    const portfolio = await portfolioService().overview('u-owner');
    const nova = portfolio.clients.find((client) => client.slug === 'nova');
    expect(nova?.lastActivityAt).toBe(T4);
  });

  it('ne renvoie rien pour un utilisateur sans appartenance', async () => {
    const portfolio = await portfolioService().overview('u-inconnu');
    expect(portfolio.clients).toEqual([]);
    expect(portfolio.totals.clients).toBe(0);
  });
});
