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
  accountId: string;
  type: CreditTransactionType;
  amount: number;
  idempotencyKey: string;
  label: string | null;
  createdAt: Date;
  /** Renseigné quand une réservation est confirmée ou remboursée. */
  settledAt: Date | null;
};

type Settled = {
  account: CreditAccount;
  transaction: CreditTransaction & { settledAt: Date | null };
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

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/**
 * Registre de crédits (§16.2).
 *
 * Une réservation débite le solde disponible sans consommer le crédit : celui-ci
 * passe en `reserved`. La confirmation consomme la réservation, le remboursement
 * la rend au solde. Une réservation réglée ne peut plus être réglée : sans cela,
 * `CONFIRM` puis `REFUND` restituait des crédits pour un travail déjà fourni.
 *
 * Les clés d'idempotence sont propres à un compte. Une clé globale permettait à
 * deux organisations choisissant la même chaîne de partager une écriture, et à
 * un membre d'une autre organisation de régler une réservation étrangère.
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
    const { account, planName, monthlyLimit } = await this.ensureAccount(organizationId);
    const existing = await this.byKey(account.id, input.idempotencyKey);
    if (existing) return { ...existing, replayed: true };

    try {
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
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await this.byKey(account.id, input.idempotencyKey);
        if (winner) return { ...winner, replayed: true };
      }
      throw error;
    }
  }

  async reserve(
    organizationId: string,
    input: ReserveCreditsInput,
    actorId?: string,
  ): Promise<CreditOperation> {
    const { account, planName, monthlyLimit } = await this.ensureAccount(organizationId);
    const existing = await this.byKey(account.id, input.idempotencyKey);
    if (existing) return { ...existing, replayed: true };

    // Contrôle de lecture pour le motif d'erreur. La vraie garde reste le
    // updateMany conditionnel ci-dessous : celle-ci supporte la concurrence.
    if (account.balance < input.amount) throw new BadRequestException('INSUFFICIENT_CREDITS');

    try {
      const result = (await this.db.client.$transaction(async (tx) => {
        // Le quota est contrôlé avant tout débit : un refus ne doit jamais
        // dépendre du rollback d'une écriture déjà faite.
        if (monthlyLimit !== null) {
          const used = await tx.creditTransaction.aggregate({
            where: { accountId: account.id, type: 'RESERVE', createdAt: { gte: monthStart() } },
            _sum: { amount: true },
          });
          if ((used._sum.amount ?? 0) + input.amount > monthlyLimit) {
            throw new BadRequestException('MONTHLY_LIMIT_REACHED');
          }
        }

        // Le débit est conditionnel : deux réservations concurrentes ne peuvent
        // pas toutes deux passer un solde contrôlé hors transaction.
        const debit = await tx.creditAccount.updateMany({
          where: { id: account.id, balance: { gte: input.amount } },
          data: { balance: { decrement: input.amount }, reserved: { increment: input.amount } },
        });
        if (debit.count === 0) throw new BadRequestException('INSUFFICIENT_CREDITS');

        const next = await tx.creditAccount.findUniqueOrThrow({ where: { id: account.id } });
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
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (isUniqueViolation(error)) {
        // Course entre deux appels avec la même clé : la seconde lecture
        // renvoie l'écriture de la première plutôt qu'un double débit.
        const winner = await this.byKey(account.id, input.idempotencyKey);
        if (winner) return { ...winner, replayed: true };
      }
      throw error;
    }
  }

  /** Passe une réservation en consommation définitive. */
  async confirm(
    organizationId: string,
    input: SettleCreditsInput,
    actorId?: string,
  ): Promise<CreditOperation> {
    return this.settle(
      organizationId,
      input,
      'CONFIRM',
      `${input.idempotencyKey}:confirm`,
      actorId,
    );
  }

  /** Rend une réservation au solde disponible après un échec. */
  async refund(
    organizationId: string,
    input: SettleCreditsInput,
    actorId?: string,
  ): Promise<CreditOperation> {
    return this.settle(organizationId, input, 'REFUND', `${input.idempotencyKey}:refund`, actorId);
  }

  /** Une clé n'est unique que dans le compte auquel elle appartient. */
  private async byKey(accountId: string, key: string): Promise<Settled | null> {
    const transaction = (await this.db.client.creditTransaction.findUnique({
      where: { accountId_idempotencyKey: { accountId, idempotencyKey: key } },
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
      transaction: { ...toTransaction(transaction), settledAt: transaction.settledAt },
    };
  }

  private async settle(
    organizationId: string,
    input: SettleCreditsInput,
    type: Extract<CreditTransactionType, 'CONFIRM' | 'REFUND'>,
    key: string,
    actorId?: string,
  ): Promise<CreditOperation> {
    const { account } = await this.ensureAccount(organizationId);

    const existing = await this.byKey(account.id, key);
    if (existing) return { ...existing, replayed: true };

    const reservation = await this.byKey(account.id, input.idempotencyKey);
    if (!reservation || reservation.transaction.type !== 'RESERVE') {
      throw new NotFoundException('Réservation introuvable');
    }
    if (reservation.transaction.settledAt) {
      throw new BadRequestException('Réservation déjà réglée');
    }

    try {
      const result = (await this.db.client.$transaction(async (tx) => {
        // Réserver le droit de régler la ligne avant toute écriture de solde.
        // Les deux clés de règlement diffèrent, seule cette réservation
        // atomique empêche CONFIRM et REFUND de s'appliquer tous les deux.
        const claim = await tx.creditTransaction.updateMany({
          where: { id: reservation.transaction.id, settledAt: null },
          data: { settledAt: new Date() },
        });
        if (claim.count === 0) throw new BadRequestException('Réservation déjà réglée');

        if (type === 'CONFIRM') {
          const consumed = await tx.creditAccount.updateMany({
            where: { id: account.id, reserved: { gte: reservation.transaction.amount } },
            data: { reserved: { decrement: reservation.transaction.amount } },
          });
          if (consumed.count === 0) throw new BadRequestException('Réservation incohérente');
        } else {
          await tx.creditAccount.update({
            where: { id: account.id },
            data: {
              reserved: { decrement: reservation.transaction.amount },
              balance: { increment: reservation.transaction.amount },
            },
          });
        }

        const next = await tx.creditAccount.findUniqueOrThrow({ where: { id: account.id } });
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
        account: toAccount(
          result.next,
          reservation.account.planName,
          reservation.account.monthlyLimit,
        ),
        transaction: toTransaction(result.transaction),
        replayed: false,
      };
    } catch (error) {
      // Deux appels simultanés avec la même clé : le perdant de la réservation
      // atomique relit l'écriture du gagnant au lieu d'un simple 400.
      const settledElsewhere =
        error instanceof BadRequestException && error.message === 'Réservation déjà réglée';
      if (settledElsewhere || isUniqueViolation(error)) {
        const winner = await this.byKey(account.id, key);
        if (winner) return { ...winner, replayed: true };
      }
      throw error;
    }
  }
}
