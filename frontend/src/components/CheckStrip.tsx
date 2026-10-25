import type { RecentCheck } from '../api/types';
import { formatDateTime, formatMs } from '../lib/format';

const SLOTS = 30;

/**
 * The last 30 checks as bars, oldest on the left. Empty slots (a new monitor)
 * are drawn as faint placeholders so every row's strip has the same width.
 */
export function CheckStrip({ checks }: { checks: RecentCheck[] }) {
  const padded: (RecentCheck | null)[] = [
    ...Array<null>(Math.max(0, SLOTS - checks.length)).fill(null),
    ...checks.slice(-SLOTS),
  ];
  const failed = checks.filter((c) => !c.up).length;
  const summary =
    checks.length === 0
      ? 'No checks yet'
      : `Last ${checks.length} checks: ${failed === 0 ? 'all passed' : `${failed} failed`}`;

  return (
    <div className="um-strip" role="img" aria-label={summary}>
      {padded.map((c, i) =>
        c ? (
          <span
            key={i}
            className={`um-strip__bar ${c.up ? 'is-up' : 'is-down'}`}
            title={`${formatDateTime(c.at)}: ${c.up ? formatMs(c.responseTimeMs) : 'failed'}`}
          />
        ) : (
          <span key={i} className="um-strip__bar is-empty" />
        ),
      )}
    </div>
  );
}
