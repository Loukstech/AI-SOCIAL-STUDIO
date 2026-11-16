import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreditAccount,
  CreditLedger,
  CreditOperation,
  CreditTransaction,
  CreditTransactionType,
  ReserveCreditsInput,
  SettleCreditsInput,
} from '@ass/shared';
import { Db } from '../common/validation.js';

type AccountRow = {
  id: string;
  organizationId: string;
  planKey: string;
  balance: number;
  reserved: number;
  updatedAt: Date;
};

type TransactionRow = {
  id: string;
  type: CreditTransactionType;
  amount: number;
  idempotencyKey: string;
  label: string | null;
  createdAt: Date;
};

function toAccount(row: AccountRow, planName: string, monthlyLimit: number | null): CreditAccount {
  return {
    id: row.id,
    organizationId: row.organizationId,
    planKey: row.planKey,
    planName,
    balance: row.balance,
    reserved: row.reserved,
    monthlyLimit,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTransaction(row: TransactionRow): CreditTransaction {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    idempotencyKey: row.idempotencyKey,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
  };
}

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Registre de crédits (§16.2).
 *
 * Une réservation débite le solde disponible sans consommer le crédit : celui-ci
 * passe en `reserved`. La confirmation consomme la réservation, le remboursement
 * la rend au solde. Chaque écriture porte une clé d'idempotence unique : rejouer
 * la même opération ne débite jamais deux fois.
 */
@Injectable()
export class CreditsService {
  constructor(@Inject(Db) private readonly db: Db) {}

  /** Crée paresseusement le compte d'une organisation existante. */
  private async ensureAccount(organizationId: string): Promise<{
    account: AccountRow;
    planName: string;
    monthlyLimit: number | null;
  }> {
    const organization = await this.db.client.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization) throw new NotFoundException('Organisation introuvable');

    const plan = await this.db.client.plan.findUnique({ where: { key: organization.planKey } });
    if (!plan) throw new BadRequestException('PLAN_UNKNOWN');

    const account = (await this.db.client.creditAccount.upsert({
      where: { organizationId },
      create: {
        organizationId,
        planKey: plan.key,
        balance: plan.monthlyCredits ?? 0,
      },
      update: {},
    })) as AccountRow;

    return { account, planName: plan.name, monthlyLimit: plan.monthlyCredits };
  }

  async account(organizationId: string): Promise<CreditAccount> {
    const { account, planName, monthlyLimit } = await this.ensureAccount(organizationId);
    return toAccount(account, planName, monthlyLimit);
  }

  async ledger(organizationId: string, limit = 30): Promise<CreditLedger> {
    const base = await this.account(organizationId);
    const rows = (await this.db.client.creditTransaction.findMany({
      where: { accountId: base.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    })) as TransactionRow[];
    return { account: base, transactions: rows.map(toTransaction) };
  }

  /** Accorde des crédits (octroi initial ou ajustement manuel). */
  async grant(
    organizationId: string,
    input: ReserveCreditsInput,
    actorId?: string,
  ): Promise<CreditOperation> {
    const existing = await this.byKey(input.idempotencyKey);
    if (existing) return { ...existing, replayed: true };

    const { account, planName, monthlyLimit } = await this.ensureAccount(organizationId);
    const updated = (await this.db.client.$transaction(async (tx) => {
      const next = await tx.creditAccount.update({
        where: { id: account.id },
        data: { balance: { increment: input.amount } },
      });
      const transaction = await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: 'GRANT',
          amount: input.amount,
          idempotencyKey: input.idempotencyKey,
          label: input.label ?? null,
          actorId: actorId ?? null,
        },
      });
      return { next, transaction };
    })) as { next: AccountRow; transaction: TransactionRow };

    return {
      account: toAccount(updated.next, planName, monthlyLimit),
      transaction: toTransaction(updated.transaction),
      replayed: false,
    };
  }

  async reserve(
    organizationId: string,
    input: ReserveCreditsInput,
    actorId?: string,
  ): Promise<CreditOperation> {
    const existing = await this.byKey(input.idempotencyKey);
    if (existing) return { ...existing, replayed: true };

    const { account, planName, monthlyLimit } = await this.ensureAccount(organizationId);
    if (account.balance < input.amount) throw new BadRequestException('INSUFFICIENT_CREDITS');

    if (monthlyLimit !== null) {
      const used = await this.db.client.creditTransaction.aggregate({
        where: { accountId: account.id, type: 'RESERVE', createdAt: { gte: monthStart() } },
        _sum: { amount: true },
      });
      if ((used._sum.amount ?? 0) + input.amount > monthlyLimit) {
        throw new BadRequestException('MONTHLY_LIMIT_REACHED');
      }
    }

    try {
      const result = (await this.db.client.$transaction(async (tx) => {
        const next = await tx.creditAccount.update({
          where: { id: account.id },
          data: { balance: { decrement: input.amount }, reserved: { increment: input.amount } },
        });
        const transaction = await tx.creditTransaction.create({
          data: {
            accountId: account.id,
            type: 'RESERVE',
            amount: input.amount,
            idempotencyKey: input.idempotencyKey,
            label: input.label ?? null,
            actorId: actorId ?? null,
          },
        });
        return { next, transaction };
      })) as { next: AccountRow; transaction: TransactionRow };

      return {
        account: toAccount(result.next, planName, monthlyLimit),
        transaction: toTransaction(result.transaction),
        replayed: false,
      };
    } catch {
      // Course entre deux appels avec la même clé : la seconde lecture renvoie
      // l'écriture de la première plutôt qu'un double débit ou une erreur 500.
      const winner = await this.byKey(input.idempotencyKey);
      if (winner) return { ...winner, replayed: true };
      throw new BadRequestException('INSUFFICIENT_CREDITS');
    }
  }

  /** Passe une réservation en consommation définitive. */
  async confirm(input: SettleCreditsInput, actorId?: string): Promise<CreditOperation> {
    return this.settle(input, 'CONFIRM', `${input.idempotencyKey}:confirm`, actorId);
  }

  /** Rend une réservation au solde disponible après un échec. */
  async refund(input: SettleCreditsInput, actorId?: string): Promise<CreditOperation> {
    return this.settle(input, 'REFUND', `${input.idempotencyKey}:refund`, actorId);
  }

  private async byKey(key: string): Promise<Omit<CreditOperation, 'replayed'> | null> {
    const transaction = (await this.db.client.creditTransaction.findUnique({
      where: { idempotencyKey: key },
      include: { account: true },
    })) as (TransactionRow & { account: AccountRow }) | null;
    if (!transaction) return null;

    const plan = await this.db.client.plan.findUnique({
      where: { key: transaction.account.planKey },
    });
    return {
      account: toAccount(
        transaction.account,
        plan?.name ?? transaction.account.planKey,
        plan?.monthlyCredits ?? null,
      ),
      transaction: toTransaction(transaction),
    };
  }

  private async settle(
    input: SettleCreditsInput,
    type: Extract<CreditTransactionType, 'CONFIRM' | 'REFUND'>,
    key: string,
    actorId?: string,
  ): Promise<CreditOperation> {
    const existing = await this.byKey(key);
    if (existing) return { ...existing, replayed: true };

    const reservation = await this.byKey(input.idempotencyKey);
    if (!reservation || reservation.transaction.type !== 'RESERVE') {
      throw new NotFoundException('Réservation introuvable');
    }

    const account = reservation.account;
    const result = (await this.db.client.$transaction(async (tx) => {
      const next = await tx.creditAccount.update({
        where: { id: account.id },
        data:
          type === 'CONFIRM'
            ? { reserved: { decrement: reservation.transaction.amount } }
            : {
                reserved: { decrement: reservation.transaction.amount },
                balance: { increment: reservation.transaction.amount },
              },
      });
      const transaction = await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type,
          amount: reservation.transaction.amount,
          idempotencyKey: key,
          label: reservation.transaction.label,
          actorId: actorId ?? null,
        },
      });
      return { next, transaction };
    })) as { next: AccountRow; transaction: TransactionRow };

    return {
      account: toAccount(result.next, account.planName, account.monthlyLimit),
      transaction: toTransaction(result.transaction),
      replayed: false,
    };
  }
}
