import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { usePublicStatus } from '../api/hooks';
import type { OverallStatus } from '../api/types';
import { Logo } from '../components/AppLayout';
import { DayBars } from '../components/DayBars';
import { formatDateTime, formatDuration, formatUptime, timeAgo } from '../lib/format';

const OVERALL: Record<OverallStatus, string> = {
  operational: 'All systems operational',
  partial_outage: 'Some systems are down',
  major_outage: 'All systems are down',
  no_monitors: 'Nothing to show yet',
};

const SERVICE_STATUS = { up: 'Operational', down: 'Down', pending: 'Checking' } as const;

/** Public, no login. Its own minimal layout: no app navigation. */
export function PublicStatusPage() {
  const { slug = '' } = useParams();
  const page = usePublicStatus(slug);

  useEffect(() => {
    if (page.data) document.title = page.data.title;
    return () => {
      document.title = 'Uptime Monitor';
    };
  }, [page.data]);

  if (page.isPending) {
    return (
      <div className="um-public">
        <p className="um-muted">Loading status…</p>
      </div>
    );
  }
  if (page.isError) {
    return (
      <div className="um-public">
        <h1>Status page not found</h1>
        <p className="um-muted">Check the link. If it was changed by its owner, ask them for the new one.</p>
      </div>
    );
  }

  const p = page.data;
  return (
    <div className="um-public">
      <header className="um-public__head">
        <h1>{p.title}</h1>
      </header>

      <div className={`um-overall is-${p.overall}`} role="status">
        <span className="um-overall__dot" aria-hidden="true" />
        <strong>{OVERALL[p.overall]}</strong>
        <span className="um-overall__time">Updated {timeAgo(p.generatedAt)}</span>
      </div>

      {p.monitors.length > 0 && (
        <ul className="um-services">
          {p.monitors.map((m, i) => (
            <li key={i} className="um-service">
              <div className="um-service__head">
                <strong>{m.name}</strong>
                <span className={`um-service__state is-${m.status}`}>{SERVICE_STATUS[m.status]}</span>
              </div>
              <DayBars days={m.days} />
              <p className="um-service__uptime">{formatUptime(m.uptime30d)} uptime over 30 days</p>
            </li>
          ))}
        </ul>
      )}

      <section className="um-public__incidents">
        <h2>Recent incidents</h2>
        {p.incidents.length === 0 ? (
          <p className="um-muted">No incidents in the last 14 days.</p>
        ) : (
          <ol className="um-incidents">
            {p.incidents.map((inc, i) => (
              <li key={i} className={inc.resolvedAt ? '' : 'is-open'}>
                <div>
                  <strong>{inc.monitorName}</strong>
                  <span className="um-muted">{inc.resolvedAt ? 'Resolved' : 'Ongoing'}</span>
                </div>
                <div className="um-incidents__time">
                  <span>{formatDateTime(inc.openedAt)}</span>
                  <span className="um-muted">
                    {inc.resolvedAt
                      ? `down for ${formatDuration(new Date(inc.resolvedAt).getTime() - new Date(inc.openedAt).getTime())}`
                      : `${formatDuration(Date.now() - new Date(inc.openedAt).getTime())} so far`}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer className="um-public__foot">
        <Logo />
        <span>Monitored with Uptime Monitor</span>
      </footer>
    </div>
  );
}
