import { useEffect, useState } from 'react';
import type { HealthResponse } from '@ass/shared';
import { api, API_URL } from '../lib/api';
import { Alert, Button, Card, PageHeader } from '../components/ui';
import { StatusBadge } from '../components/StatusBadge';

export function SystemPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api
      .health(controller.signal)
      .then(setHealth)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setHealth(null);
        setError(cause instanceof Error ? cause.message : 'Erreur inconnue');
      });
    return () => controller.abort();
  }, [attempt]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="État du système"
        description="Diagnostic temps réel de l'infrastructure (Phase 0)."
        action={
          <Button
            variant="ghost"
            onClick={() => {
              setError('');
              setAttempt((n) => n + 1);
            }}
          >
            Revérifier
          </Button>
        }
      />
      {error && <Alert>{error}</Alert>}
      <Card>
        <dl className="divide-y divide-border">
          <Row label="API">
            <StatusBadge status={health ? 'up' : 'down'} />
          </Row>
          <Row label="PostgreSQL">
            <StatusBadge status={health?.dependencies.database ?? 'not_configured'} />
          </Row>
          <Row label="Redis">
            <StatusBadge status={health?.dependencies.redis ?? 'not_configured'} />
          </Row>
        </dl>
        <p className="mt-4 text-xs text-text-muted">
          {API_URL} · {health ? `v${health.version} · ${health.environment}` : 'en attente'}
        </p>
      </Card>
    </div>
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
