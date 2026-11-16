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
}

interface Plan {
  key: string;
  name: string;
  monthlyCredits: number | null;
  active: boolean;
}

function fakeDb(monthlyCredits: number | null = 100) {
  const accounts: Account[] = [];
  const transactions: Transaction[] = [];
  const plans: Plan[] = [{ key: 'pro', name: 'Pro', monthlyCredits, active: true }];
  const organizations = [{ id: 'org-1', planKey: 'pro' }];
  let sequence = 0;

  const bump = (
    current: number,
    value: number | { increment?: number; decrement?: number },
  ): number => {
    if (typeof value === 'number') return value;
    return current + (value.increment ?? 0) - (value.decrement ?? 0);
  };

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
      upsert: async ({ create }: { create: Omit<Account, 'id' | 'updatedAt'> }) => {
        let account = accounts.find((row) => row.organizationId === create.organizationId);
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
        data: {
          balance?: number | { increment?: number; decrement?: number };
          reserved?: number | { increment?: number; decrement?: number };
        };
      }) => {
        const account = accounts.find((row) => row.id === where.id);
        if (!account) throw new Error('compte introuvable');
        if (data.balance !== undefined) account.balance = bump(account.balance, data.balance);
        if (data.reserved !== undefined) account.reserved = bump(account.reserved, data.reserved);
        account.updatedAt = new Date();
        return { ...account };
      },
    },
    creditTransaction: {
      findUnique: async ({
        where,
        include,
      }: {
        where: { idempotencyKey: string };
        include?: { account: true };
      }) => {
        const row = transactions.find((item) => item.idempotencyKey === where.idempotencyKey);
        if (!row) return null;
        if (include?.account) {
          const account = accounts.find((item) => item.id === row.accountId);
          return { ...row, account: account ? { ...account } : null };
        }
        return { ...row };
      },
      findMany: async ({ where, take }: { where: { accountId: string }; take: number }) =>
        transactions.filter((row) => row.accountId === where.accountId).slice(0, take),
      create: async ({ data }: { data: Omit<Transaction, 'id' | 'createdAt'> }) => {
        if (transactions.some((row) => row.idempotencyKey === data.idempotencyKey)) {
          throw new Error('UNIQUE_CONSTRAINT');
        }
        const row: Transaction = { id: `txn-${++sequence}`, ...data, createdAt: new Date() };
        transactions.push(row);
        return { ...row };
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
      {
        amount: 30,
        idempotencyKey: 'reserve-1',
        label: 'Clip vidéo',
      },
      actor,
    );

    expect(reserved.replayed).toBe(false);
    expect(reserved.account.balance).toBe(70);
    expect(reserved.account.reserved).toBe(30);

    const confirmed = await service.confirm({ idempotencyKey: 'reserve-1' }, actor);
    expect(confirmed.transaction.type).toBe('CONFIRM');
    expect(confirmed.account.balance).toBe(70);
    expect(confirmed.account.reserved).toBe(0);

    const replay = await service.confirm({ idempotencyKey: 'reserve-1' }, actor);
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
    const refunded = await service.refund({ idempotencyKey: 'reserve-3' }, actor);

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
    await limitedService.refund({ idempotencyKey: 'quota-1' }, actor);
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
});
