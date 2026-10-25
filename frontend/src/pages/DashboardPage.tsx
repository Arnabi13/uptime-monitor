import { Link } from 'react-router-dom';
import { useMonitors, useOverview } from '../api/hooks';
import type { Monitor, MonitorOverview } from '../api/types';
import { CheckStrip } from '../components/CheckStrip';
import { StatusPill } from '../components/StatusPill';
import { formatInterval, formatMs, formatUptime, timeAgo } from '../lib/format';

/** The page heading is the answer to "is everything OK?" in one sentence. */
export function headline(monitors: Monitor[]): { text: string; tone: 'good' | 'bad' | 'neutral' } {
  const active = monitors.filter((m) => m.isActive);
  if (active.length === 0) return { text: 'All monitors are paused', tone: 'neutral' };
  const down = active.filter((m) => m.status === 'down').length;
  const pending = active.filter((m) => m.status === 'pending').length;
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  if (down > 0) {
    return {
      text:
        active.length === 1
          ? 'Your monitor is down'
          : `${down} of ${active.length} monitors ${plural(down, 'is', 'are')} down`,
      tone: 'bad',
    };
  }
  if (pending > 0) {
    const up = active.length - pending;
    return {
      text:
        up === 0
          ? `Waiting for the first ${plural(pending, 'check', 'checks')}`
          : `${up} up, ${pending} waiting for a first check`,
      tone: 'neutral',
    };
  }
  return {
    text: active.length === 1 ? 'Your monitor is up' : `All ${active.length} monitors are up`,
    tone: 'good',
  };
}

const STATUS_ORDER = { down: 0, pending: 1, up: 2, paused: 3 } as const;

export function DashboardPage() {
  const monitors = useMonitors();
  const overview = useOverview();

  if (monitors.isPending) return <p className="um-muted">Loading monitors…</p>;
  if (monitors.isError) {
    return (
      <p className="um-alert" role="alert">
        Couldn't load your monitors. {monitors.error.message}
      </p>
    );
  }

  const list = [...monitors.data].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const byId = new Map<string, MonitorOverview>((overview.data ?? []).map((o) => [o.monitorId, o]));

  if (list.length === 0) return <EmptyState />;

  const head = headline(list);

  return (
    <>
      <div className="um-pagehead">
        <div>
          <h1 className={`um-headline is-${head.tone}`}>{head.text}</h1>
          <p className="um-muted">
            Updated {timeAgo(new Date(monitors.dataUpdatedAt).toISOString())}. Refreshes every 30 seconds.
          </p>
        </div>
        <Link to="/monitors/new" className="um-btn um-btn--primary">
          Add monitor
        </Link>
      </div>

      <ul className="um-list" aria-label="Monitors">
        {list.map((m) => {
          const o = byId.get(m.id);
          return (
            <li key={m.id}>
              <Link to={`/monitors/${m.id}`} className={`um-row ${m.status === 'down' ? 'is-down' : ''}`}>
                <div className="um-row__status">
                  <StatusPill status={m.status} />
                </div>
                <div className="um-row__name">
                  <strong>{m.name}</strong>
                  <span className="um-url">{m.url.replace(/^https?:\/\//, '')}</span>
                </div>
                <div className="um-row__strip">
                  <CheckStrip checks={o?.recent ?? []} />
                </div>
                <dl className="um-row__figures">
                  <div>
                    <dt>Uptime 24h</dt>
                    <dd>{formatUptime(o?.uptime24h ?? null)}</dd>
                  </div>
                  <div>
                    <dt>Response</dt>
                    <dd>{formatMs(o?.avgResponseMs24h ?? null)}</dd>
                  </div>
                  <div>
                    <dt>Checked</dt>
                    <dd>{m.isActive ? timeAgo(m.lastCheckedAt) : `every ${formatInterval(m.intervalSeconds)}`}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function EmptyState() {
  return (
    <div className="um-empty">
      <h1>Add your first monitor</h1>
      <p>
        Give us a URL and we'll request it every few minutes. If it stops answering, you get an email,
        and another when it's back.
      </p>
      <Link to="/monitors/new" className="um-btn um-btn--primary">
        Add monitor
      </Link>
    </div>
  );
}
