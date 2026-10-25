import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  useDeleteMonitor,
  useHistory,
  useIncidents,
  useMonitor,
  useMonitorStats,
  useUpdateMonitor,
} from '../api/hooks';
import type { HistoryRange } from '../api/types';
import { ResponseChart } from '../components/ResponseChart';
import { StatusPill } from '../components/StatusPill';
import { formatDateTime, formatDuration, formatInterval, formatMs, formatUptime, timeAgo } from '../lib/format';

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

export function MonitorDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [range, setRange] = useState<HistoryRange>('24h');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const monitor = useMonitor(id);
  const stats = useMonitorStats(id);
  const history = useHistory(id, range);
  const incidents = useIncidents(id);
  const update = useUpdateMonitor(id);
  const remove = useDeleteMonitor();

  if (monitor.isPending) return <p className="um-muted">Loading…</p>;
  if (monitor.isError) {
    return (
      <div className="um-empty">
        <h1>Monitor not found</h1>
        <p>It may have been deleted.</p>
        <Link to="/" className="um-btn um-btn--primary">
          Back to monitors
        </Link>
      </div>
    );
  }

  const m = monitor.data;
  const open = stats.data?.openIncident ?? null;

  return (
    <>
      <Link to="/" className="um-back">
        All monitors
      </Link>

      <div className="um-pagehead">
        <div className="um-detailhead">
          <div className="um-detailhead__title">
            <h1>{m.name}</h1>
            <StatusPill status={m.status} />
          </div>
          <a href={m.url} target="_blank" rel="noopener noreferrer" className="um-url um-url--link">
            {m.url}
          </a>
          <p className="um-muted">
            {m.isActive
              ? `${m.method} every ${formatInterval(m.intervalSeconds)}. Last checked ${timeAgo(m.lastCheckedAt)}.`
              : 'Paused. No checks are running and no alerts will be sent.'}
          </p>
        </div>
        <div className="um-actions">
          <button
            type="button"
            className="um-btn"
            disabled={update.isPending}
            onClick={() => update.mutate({ isActive: !m.isActive })}
          >
            {m.isActive ? 'Pause' : 'Resume'}
          </button>
          <Link to={`/monitors/${m.id}/edit`} className="um-btn">
            Edit
          </Link>
          {confirmDelete ? (
            <>
              <button
                type="button"
                className="um-btn um-btn--danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate(m.id, { onSuccess: () => navigate('/') })}
              >
                {remove.isPending ? 'Deleting…' : 'Delete for good'}
              </button>
              <button type="button" className="um-btn um-btn--quiet" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </>
          ) : (
            <button type="button" className="um-btn um-btn--quiet" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
        </div>
      </div>

      {update.error && <p className="um-alert">{update.error.message}</p>}
      {remove.error && <p className="um-alert">{remove.error.message}</p>}
      {confirmDelete && (
        <p className="um-alert um-alert--warn">
          Deleting removes this monitor, its check history and its incidents. This can't be undone.
        </p>
      )}

      {open && (
        <div className="um-incident-banner" role="status">
          <strong>Down for {formatDuration(Date.now() - new Date(open.openedAt).getTime())}</strong>
          <span>
            Failing since {formatDateTime(open.openedAt)} with "{open.cause}". An alert email went out when it
            started; you'll get another when it recovers.
          </span>
        </div>
      )}

      <dl className="um-figures">
        <Figure label="Uptime, 24 hours" value={formatUptime(stats.data?.uptime.h24 ?? null)} />
        <Figure label="Uptime, 7 days" value={formatUptime(stats.data?.uptime.d7 ?? null)} />
        <Figure label="Uptime, 30 days" value={formatUptime(stats.data?.uptime.d30 ?? null)} />
        <Figure label="Avg response, 24 hours" value={formatMs(stats.data?.avgResponseMs24h ?? null)} />
      </dl>

      <section className="um-panel" aria-labelledby="rt-heading">
        <div className="um-panel__head">
          <h2 id="rt-heading">Response time</h2>
          <div className="um-tabs" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={range === r.value}
                className={range === r.value ? 'is-on' : ''}
                onClick={() => setRange(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {history.data && history.data.length > 0 ? (
          <ResponseChart buckets={history.data} range={range} />
        ) : (
          <p className="um-chart-empty">
            {history.isPending ? 'Loading…' : 'No checks in this period yet. The first one runs within a minute.'}
          </p>
        )}
        <p className="um-legend">
          <span>
            <span className="um-legend__line" /> Average response time of successful checks
          </span>
          <span>
            <span className="um-legend__fail" /> Period with a failed check
          </span>
        </p>
      </section>

      <div className="um-two">
        <section className="um-panel" aria-labelledby="inc-heading">
          <h2 id="inc-heading">Incidents</h2>
          {incidents.data && incidents.data.length > 0 ? (
            <ol className="um-incidents">
              {incidents.data.map((i) => (
                <li key={i.id} className={i.resolvedAt ? '' : 'is-open'}>
                  <div>
                    <strong>{i.resolvedAt ? 'Resolved' : 'Ongoing'}</strong>
                    <span className="um-muted">{i.cause}</span>
                  </div>
                  <div className="um-incidents__time">
                    <span>{formatDateTime(i.openedAt)}</span>
                    <span className="um-muted">
                      {i.resolvedAt
                        ? `lasted ${formatDuration(new Date(i.resolvedAt).getTime() - new Date(i.openedAt).getTime())}`
                        : `${formatDuration(Date.now() - new Date(i.openedAt).getTime())} so far`}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="um-muted">
              No incidents. One opens after 3 failed checks in a row, so a single slow response won't page you.
            </p>
          )}
        </section>

        <section className="um-panel" aria-labelledby="set-heading">
          <h2 id="set-heading">Settings</h2>
          <dl className="um-settings">
            <dt>Interval</dt>
            <dd>{formatInterval(m.intervalSeconds)}</dd>
            <dt>Method</dt>
            <dd>{m.method}</dd>
            <dt>Timeout</dt>
            <dd>{m.timeoutMs / 1000} seconds</dd>
            <dt>Counts as up</dt>
            <dd>{m.expectedStatusCode ? `HTTP ${m.expectedStatusCode}` : 'Any 2xx or 3xx'}</dd>
            <dt>Status page</dt>
            <dd>{m.isPublic ? 'Shown' : 'Hidden'}</dd>
            <dt>Added</dt>
            <dd>{formatDateTime(m.createdAt)}</dd>
          </dl>
        </section>
      </div>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="um-figure">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
