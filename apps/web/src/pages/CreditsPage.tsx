import { useCallback, useState } from 'react';
import { Alert, Button, Card, Empty, Field, formatDate, PageHeader, Stat } from '../components/ui';
import { api } from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';

/** Registre de crédits visible par l'organisation (§16.2). */
export function CreditsPage() {
  const loadLedger = useCallback(() => api.credits.ledger(), []);
  const ledger = useAsyncData(loadLedger);
  const [amount, setAmount] = useState('10');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function run(name: string, action: () => Promise<unknown>) {
    setBusy(name);
    setError('');
    try {
      await action();
      ledger.reload();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Opération impossible');
    } finally {
      setBusy('');
    }
  }

  const account = ledger.data?.account;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Crédits et quotas"
        description="Réserver avant traitement, confirmer au succès, rembourser à l'échec."
        action={
          <Button variant="ghost" onClick={ledger.reload} disabled={Boolean(busy)}>
            Actualiser
          </Button>
        }
      />

      {error && <Alert>{error}</Alert>}
      {ledger.error && <Alert>{ledger.error}</Alert>}

      {account && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Solde disponible" value={account.balance} />
          <Stat label="Réservé" value={account.reserved} />
          <Stat label={`Quota ${account.planName}`} value={account.monthlyLimit ?? 'Illimité'} />
        </div>
      )}

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Réserver des crédits</h2>
        <div className="grid gap-4 sm:grid-cols-[120px_1fr_auto] sm:items-end">
          <Field
            label="Montant"
            type="number"
            min={1}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <Field
            label="Motif"
            value={label}
            placeholder="Ex. transcription vidéo"
            onChange={(event) => setLabel(event.target.value)}
          />
          <Button
            disabled={Boolean(busy) || Number(amount) < 1}
            onClick={() =>
              void run('réservation', () =>
                api.credits.reserve({
                  amount: Number(amount),
                  idempotencyKey: crypto.randomUUID(),
                  ...(label ? { label } : {}),
                }),
              )
            }
          >
            Réserver
          </Button>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Une clé unique est générée pour chaque réservation : un rejeu ne débite jamais deux fois.
        </p>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Journal des mouvements</h2>
        {ledger.data?.transactions.length ? (
          <ul className="divide-y divide-border text-sm">
            {ledger.data.transactions.map((transaction) => (
              <li
                key={transaction.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2"
              >
                <div>
                  <span className="font-medium">{transaction.type}</span>
                  <span className="ml-2 tabular-nums">{transaction.amount}</span>
                  {transaction.label && (
                    <span className="ml-2 text-text-muted">· {transaction.label}</span>
                  )}
                  <span className="block text-xs text-text-muted">
                    {formatDate(transaction.createdAt)} · {transaction.idempotencyKey}
                  </span>
                </div>
                {transaction.type === 'RESERVE' && (
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void run('confirmation', () =>
                          api.credits.confirm({ idempotencyKey: transaction.idempotencyKey }),
                        )
                      }
                    >
                      Confirmer
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void run('remboursement', () =>
                          api.credits.refund({ idempotencyKey: transaction.idempotencyKey }),
                        )
                      }
                    >
                      Rembourser
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Aucun mouvement enregistré.</Empty>
        )}
      </Card>
    </div>
  );
}
