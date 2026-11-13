import type { DependencyStatus } from '@ass/shared';

const LABELS: Record<DependencyStatus, string> = {
  up: 'Opérationnel',
  down: 'Injoignable',
  not_configured: 'Non configuré',
};

const TONES: Record<DependencyStatus, string> = {
  up: 'text-success',
  down: 'text-danger',
  not_configured: 'text-warning',
};

export function StatusBadge({ status }: { status: DependencyStatus }) {
  return (
    <span className={`inline-flex items-center gap-2 text-sm font-medium ${TONES[status]}`}>
      <span aria-hidden="true" className="size-2 rounded-full bg-current" />
      {LABELS[status]}
    </span>
  );
}
