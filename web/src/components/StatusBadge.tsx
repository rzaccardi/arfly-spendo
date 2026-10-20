const LABELS: Record<string, string> = {
  succeeded: 'Riuscito',
  failed: 'Fallito',
  pending: 'In coda',
  running: 'In corso',
  skipped: 'Saltato',
  active: 'Attiva',
  inactive: 'Inattiva',
  expired: 'Scaduta',
  dead: 'Abbandonata',
  booked: 'Contabilizzato',
};

export function statusClass(status: string): string {
  if (
    status === 'succeeded' ||
    status === 'active' ||
    status === 'ok' ||
    status === 'booked'
  ) {
    return 'ok';
  }
  if (status === 'failed' || status === 'dead' || status === 'expired') {
    return 'fail';
  }
  return 'warn';
}

export function statusLabel(status: string): string {
  return LABELS[status] ?? status;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${statusClass(status)}`}>{statusLabel(status)}</span>;
}
