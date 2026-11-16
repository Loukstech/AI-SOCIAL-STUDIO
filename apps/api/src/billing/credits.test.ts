import { beforeEach, describe, expect, it } from 'vitest';
import type { CreditTransactionType } from '@ass/shared';
import type { Db } from '../common/validation.js';
import { CreditsService } from './credits.service.js';

interface Account {
  id: string;
  organizationId: string;
  planKey: string;
  balance: number;
  reserved: number;
  updatedAt: Date;
}

interface Transaction {
  id: string;
  accountId: string;
  type: CreditTransactionType;
  amount: number;
  idempotencyKey: string;
  label: string | null;
  actorId: string | null;
  createdAt: Date;
  settledAt: Date | null;
}

interface Plan {
  key: string;
  name: string;
  monthlyCredits: number | null;
  active: boolean;
}

type Delta = number | { increment?: number; decrement?: number };

function bump(current: number, value: Delta): number {
  if (typeof value === 'number') return value;
  return current + (value.increment ?? 0) - (value.decrement ?? 0);
}

function fakeDb(monthlyCredits: number | null = 100, initialBalance?: number) {
  const organizations = [
    { id: 'org-1', planKey: 'pro' },
    { id: 'org-2', planKey: 'pro' },
  ];
  const plans: Plan[] = [{ key: 'pro', name: 'Pro', monthlyCredits, active: true }];
  const accounts: Account[] = [
    {
      id: 'acc-1',
      organizationId: 'org-1',
      planKey: 'pro',
      balance: initialBalance ?? monthlyCredits ?? 0,
      reserved: 0,
      updatedAt: new Date(),
    },
    {
      id: 'acc-2',
      organizationId: 'org-2',
      planKey: 'pro',
      balance: initialBalance ?? monthlyCredits ?? 0,
      reserved: 0,
      updatedAt: new Date(),
    },
  ];
  const transactions: Transaction[] = [];
  let sequence = 0;

  const client = {
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        organizations.find((org) => org.id === where.id) ?? null,
    },
    plan: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        plans.find((plan) => plan.key === where.key) ?? null,
    },
    creditAccount: {
      upsert: async ({
        where,
        create,
      }: {
        where: { organizationId: string };
        create: Omit<Account, 'id' | 'updatedAt'>;
      }) => {
        let account = accounts.find((row) => row.organizationId === where.organizationId);
        if (!account) {
          account = {
            id: `acc-${++sequence}`,
            ...create,
            reserved: create.reserved ?? 0,
            updatedAt: new Date(),
          };
          accounts.push(account);
        }
        return { ...account };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { balance?: Delta; reserved?: Delta };
      }) => {
        const account = accounts.find((row) => row.id === where.id);
        if (!account) throw new Error('compte introuvable');
        if (data.balance !== undefined) account.balance = bump(account.balance, data.balance);
        if (data.reserved !== undefined) account.reserved = bump(account.reserved, data.reserved);
        account.updatedAt = new Date();
        return { ...account };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; balance?: { gte: number }; reserved?: { gte: number } };
        data: { balance?: Delta; reserved?: Delta };
      }) => {
        const account = accounts.find((row) => row.id === where.id);
        if (!account) return { count: 0 };
        if (where.balance && account.balance < where.balance.gte) return { count: 0 };
        if (where.reserved && account.reserved < where.reserved.gte) return { count: 0 };
        if (data.balance !== undefined) account.balance = bump(account.balance, data.balance);
        if (data.reserved !== undefined) account.reserved = bump(account.reserved, data.reserved);
        account.updatedAt = new Date();
        return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const account = accounts.find((row) => row.id === where.id);
        if (!account) throw new Error('compte introuvable');
        return { ...account };
      },
    },
    creditTransaction: {
      findUnique: async ({
        where,
        include,
      }: {
        where: {
          accountId_idempotencyKey: { accountId: string; idempotencyKey: string };
        };
        include?: { account: true };
      }) => {
        const { accountId, idempotencyKey } = where.accountId_idempotencyKey;
        const row = transactions.find(
          (item) => item.accountId === accountId && item.idempotencyKey === idempotencyKey,
        );
        if (!row) return null;
        if (include?.account) {
          const account = accounts.find((item) => item.id === row.accountId);
          return { ...row, account: account ? { ...account } : null };
        }
        return { ...row };
      },
      findMany: async ({ where, take }: { where: { accountId: string }; take: number }) =>
        transactions.filter((row) => row.accountId === where.accountId).slice(0, take),
      create: async ({ data }: { data: Omit<Transaction, 'id' | 'createdAt' | 'settledAt'> }) => {
        const duplicate = transactions.some(
          (row) => row.accountId === data.accountId && row.idempotencyKey === data.idempotencyKey,
        );
        if (duplicate) throw Object.assign(new Error('UNIQUE_CONSTRAINT'), { code: 'P2002' });
        const row: Transaction = {
          id: `txn-${++sequence}`,
          ...data,
          settledAt: null,
          createdAt: new Date(),
        };
        transactions.push(row);
        return { ...row };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; settledAt: null };
        data: { settledAt: Date };
      }) => {
        const row = transactions.find((item) => item.id === where.id && item.settledAt === null);
        if (!row) return { count: 0 };
        row.settledAt = data.settledAt;
        return { count: 1 };
      },
      aggregate: async ({
        where,
      }: {
        where: { accountId: string; type: CreditTransactionType; createdAt: { gte: Date } };
      }) => ({
        _sum: {
          amount: transactions
            .filter(
              (row) =>
                row.accountId === where.accountId &&
                row.type === where.type &&
                row.createdAt >= where.createdAt.gte,
            )
            .reduce((sum, row) => sum + row.amount, 0),
        },
      }),
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(client),
  };

  return { db: { client } as unknown as Db, accounts, transactions };
}

const actor = 'user-1';

describe('registre de crédits (§16.2)', () => {
  let context: ReturnType<typeof fakeDb>;
  let service: CreditsService;

  beforeEach(() => {
    context = fakeDb();
    service = new CreditsService(context.db);
  });

  it('réserve sans consommer, puis confirme exactement une fois', async () => {
    const reserved = await service.reserve(
      'org-1',
      { amount: 30, idempotencyKey: 'reserve-1', label: 'Clip vidéo' },
      actor,
    );

    expect(reserved.replayed).toBe(false);
    expect(reserved.account.balance).toBe(70);
    expect(reserved.account.reserved).toBe(30);

    const confirmed = await service.confirm('org-1', { idempotencyKey: 'reserve-1' }, actor);
    expect(confirmed.transaction.type).toBe('CONFIRM');
    expect(confirmed.account.balance).toBe(70);
    expect(confirmed.account.reserved).toBe(0);

    const replay = await service.confirm('org-1', { idempotencyKey: 'reserve-1' }, actor);
    expect(replay.replayed).toBe(true);
    expect(replay.account.reserved).toBe(0);
  });

  it('ne débite jamais deux fois avec la même clé d’idempotence', async () => {
    await service.reserve('org-1', { amount: 20, idempotencyKey: 'reserve-2' }, actor);
    const replay = await service.reserve(
      'org-1',
      { amount: 20, idempotencyKey: 'reserve-2' },
      actor,
    );

    expect(replay.replayed).toBe(true);
    expect(replay.account.balance).toBe(80);
    expect(replay.account.reserved).toBe(20);
    expect(context.transactions).toHaveLength(1);
  });

  it('rembourse une réservation à la place de la consommer', async () => {
    await service.reserve('org-1', { amount: 40, idempotencyKey: 'reserve-3' }, actor);
    const refunded = await service.refund('org-1', { idempotencyKey: 'reserve-3' }, actor);

    expect(refunded.transaction.type).toBe('REFUND');
    expect(refunded.account.balance).toBe(100);
    expect(refunded.account.reserved).toBe(0);
  });

  it('refuse un débit sans solde suffisant', async () => {
    await expect(
      service.reserve('org-1', { amount: 101, idempotencyKey: 'reserve-4' }, actor),
    ).rejects.toThrow('INSUFFICIENT_CREDITS');
  });

  it('refuse de dépasser le quota mensuel du plan', async () => {
    const limited = fakeDb(50);
    const limitedService = new CreditsService(limited.db);
    await limitedService.reserve('org-1', { amount: 30, idempotencyKey: 'quota-1' }, actor);

    // Un remboursement recrédite le solde, mais le quota mensuel reste consommé.
    await limitedService.refund('org-1', { idempotencyKey: 'quota-1' }, actor);
    await expect(
      limitedService.reserve('org-1', { amount: 30, idempotencyKey: 'quota-2' }, actor),
    ).rejects.toThrow('MONTHLY_LIMIT_REACHED');
  });

  it('accorde des crédits sans double écriture sur rejeu', async () => {
    const granted = await service.grant('org-1', { amount: 25, idempotencyKey: 'grant-1' }, actor);
    const replay = await service.grant('org-1', { amount: 25, idempotencyKey: 'grant-1' }, actor);

    expect(granted.account.balance).toBe(125);
    expect(replay.replayed).toBe(true);
    expect(replay.account.balance).toBe(125);
  });

  // ---- Régressions des trois bugs trouvés en revue ----

  it('confirmer puis rembourser ne restitue aucun crédit', async () => {
    await service.reserve('org-1', { amount: 30, idempotencyKey: 'settled-once' }, actor);
    await service.confirm('org-1', { idempotencyKey: 'settled-once' }, actor);

    await expect(
      service.refund('org-1', { idempotencyKey: 'settled-once' }, actor),
    ).rejects.toThrow('Réservation déjà réglée');

    expect(context.accounts[0]!.balance).toBe(70);
    expect(context.accounts[0]!.reserved).toBe(0);
    expect(context.transactions).toHaveLength(2);
  });

  it('rembourser puis confirmer ne consomme pas deux fois la réservation', async () => {
    await service.reserve('org-1', { amount: 30, idempotencyKey: 'settled-twice' }, actor);
    await service.refund('org-1', { idempotencyKey: 'settled-twice' }, actor);

    await expect(
      service.confirm('org-1', { idempotencyKey: 'settled-twice' }, actor),
    ).rejects.toThrow('Réservation déjà réglée');

    expect(context.accounts[0]!.balance).toBe(100);
    expect(context.accounts[0]!.reserved).toBe(0);
  });

  it('deux organisations peuvent utiliser la même clé sans partager l’écriture', async () => {
    const first = await service.reserve(
      'org-1',
      { amount: 10, idempotencyKey: 'cle-partagee' },
      actor,
    );
    const second = await service.reserve(
      'org-2',
      { amount: 20, idempotencyKey: 'cle-partagee' },
      actor,
    );

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(false);
    expect(context.accounts[0]!.balance).toBe(90);
    expect(context.accounts[1]!.balance).toBe(80);
    expect(context.transactions).toHaveLength(2);
  });

  it('un membre d’une autre organisation ne peut pas régler une réservation étrangère', async () => {
    await service.reserve('org-1', { amount: 10, idempotencyKey: 'privee' }, actor);

    await expect(service.confirm('org-2', { idempotencyKey: 'privee' }, actor)).rejects.toThrow(
      'Réservation introuvable',
    );

    expect(context.accounts[0]!.balance).toBe(90);
    expect(context.accounts[0]!.reserved).toBe(10);
    expect(context.accounts[1]!.balance).toBe(100);
  });

  it('deux réservations concurrentes ne rendent jamais le solde négatif', async () => {
    await service.reserve('org-1', { amount: 60, idempotencyKey: 'concurrence-1' }, actor);
    await expect(
      service.reserve('org-1', { amount: 60, idempotencyKey: 'concurrence-2' }, actor),
    ).rejects.toThrow('INSUFFICIENT_CREDITS');

    expect(context.accounts[0]!.balance).toBe(40);
    expect(context.accounts[0]!.reserved).toBe(60);
    expect(context.transactions).toHaveLength(1);
  });

  it('le quota mensuel tient même quand deux réservations partent ensemble', async () => {
    const limited = fakeDb(50, 100);
    const limitedService = new CreditsService(limited.db);
    await limitedService.reserve(
      'org-1',
      { amount: 30, idempotencyKey: 'quota-concurrent-1' },
      actor,
    );

    await expect(
      limitedService.reserve('org-1', { amount: 30, idempotencyKey: 'quota-concurrent-2' }, actor),
    ).rejects.toThrow('MONTHLY_LIMIT_REACHED');

    expect(limited.accounts[0]!.balance).toBe(70);
  });
});
