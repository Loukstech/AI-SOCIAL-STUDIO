import type { HealthResponse } from '@ass/shared';
import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from './components/StatusBadge';
import { API_URL, fetchHealth } from './lib/api';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; health: HealthResponse };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((health) => setState({ kind: 'ready', health }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-4 py-12">
      <header className="space-y-2">
        <p className="text-sm font-medium text-accent">Phase 0 · socle technique</p>
        <h1 className="text-3xl font-semibold tracking-tight">AI Social Studio</h1>
        <p className="text-text-muted">
          Cette page vérifie en direct que le frontend joint l'API et que l'API joint ses services.
          Les modules du produit arrivent à partir de la Phase 1.
        </p>
      </header>

      <section
        aria-live="polite"
        aria-busy={state.kind === 'loading'}
        className="rounded-xl border border-border bg-surface p-5"
      >
        {state.kind === 'loading' && <p className="text-text-muted">Interrogation de l'API…</p>}

        {state.kind === 'error' && (
          <div className="space-y-3">
            <p className="font-medium text-danger">API injoignable</p>
            <p className="text-sm text-text-muted">
              Aucune réponse valide de <code className="break-all">{API_URL}</code> ({state.message}
              ). Vérifiez que l'API est démarrée et que <code>VITE_API_URL</code> pointe vers elle.
            </p>
            <RetryButton onClick={retry} />
          </div>
        )}

        {state.kind === 'ready' && (
          <div className="space-y-4">
            <dl className="divide-y divide-border">
              <Row label="API">
                <StatusBadge status="up" />
              </Row>
              <Row label="PostgreSQL">
                <StatusBadge status={state.health.dependencies.database} />
              </Row>
              <Row label="Redis">
                <StatusBadge status={state.health.dependencies.redis} />
              </Row>
            </dl>
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-text-muted">
                v{state.health.version} · {state.health.environment} · vérifié à{' '}
                {new Date(state.health.timestamp).toLocaleTimeString('fr-FR')}
              </p>
              <RetryButton onClick={retry} />
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <dt className="font-medium">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      Revérifier
    </button>
  );
}
