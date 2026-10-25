const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "just now", "3 minutes ago", "2 hours ago", "yesterday". */
export function timeAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'never';
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86_400), 'day');
}

/** 60 → "1 min", 300 → "5 min", 3600 → "1 hour", 86400 → "1 day". */
export function formatInterval(seconds: number): string {
  if (seconds % 86_400 === 0) return seconds === 86_400 ? '1 day' : `${seconds / 86_400} days`;
  if (seconds % 3600 === 0) return seconds === 3600 ? '1 hour' : `${seconds / 3600} hours`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

/** 3_725_000 ms → "1h 2m", 95_000 → "1m 35s". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  // Seconds only matter for short outages: "1m 35s", but "25m" not "25m 0s".
  if (m >= 10 || (m > 0 && s % 60 === 0)) return `${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/**
 * Uptime is shown with the precision that matters: 100% vs 99.98% is a real
 * difference, 99.981% vs 99.984% is noise.
 */
export function formatUptime(pct: number | null): string {
  if (pct === null) return '—';
  if (pct === 100) return '100%';
  return `${pct.toFixed(2)}%`;
}

/** Axis labels: round values, no trailing zeros ("1 s", "1.5 s", "250 ms"). */
export function formatAxisMs(ms: number): string {
  return ms >= 1000 ? `${Number((ms / 1000).toFixed(2))} s` : `${Math.round(ms)} ms`;
}

export function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

const dateTime = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
/** "2026-10-24" (a UTC day) → "24 Oct". */
export function formatDay(isoDate: string): string {
  return dayFmt.format(new Date(`${isoDate}T00:00:00Z`));
}
