import type { MonitorStatus } from '../api/types';

const LABELS: Record<MonitorStatus, string> = {
  up: 'Up',
  down: 'Down',
  pending: 'Checking',
  paused: 'Paused',
};

export function StatusPill({ status }: { status: MonitorStatus }) {
  return (
    <span className={`um-pill um-pill--${status}`}>
      <span className="um-pill__dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
