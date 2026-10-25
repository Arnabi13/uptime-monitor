import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Incident } from '../incidents/incident.entity';

export type HistoryRange = '24h' | '7d' | '30d';

/**
 * Each range is cut into ~90 buckets, so the chart always gets about the same
 * number of points — however often the monitor runs. 30 days of a 60s monitor
 * is 43,200 raw rows; nobody wants those shipped to a browser.
 */
const RANGES: Record<HistoryRange, { span: string; bucket: string }> = {
  '24h': { span: '24 hours', bucket: '15 minutes' },
  '7d': { span: '7 days', bucket: '2 hours' },
  '30d': { span: '30 days', bucket: '8 hours' },
};

/** How many recent checks the dashboard shows as little up/down bars. */
const RECENT_CHECKS = 30;

export interface HistoryBucket {
  t: string;
  avgResponseMs: number | null;
  up: number;
  total: number;
}

export interface MonitorOverview {
  monitorId: string;
  uptime24h: number | null;
  avgResponseMs24h: number | null;
  /** Oldest first. */
  recent: { at: string; up: boolean; responseTimeMs: number | null }[];
}

export interface MonitorStats {
  uptime: { h24: number | null; d7: number | null; d30: number | null };
  avgResponseMs24h: number | null;
  checks24h: number;
  openIncident: { id: string; cause: string; openedAt: Date } | null;
}

/** Percentage with 2 decimals, or null when there were no checks at all. */
export function uptimePct(up: number, total: number): number | null {
  return total === 0 ? null : Math.round((up / total) * 10_000) / 100;
}

/**
 * Read-side queries for the dashboard. Ownership is checked by the caller
 * (MonitorsService.findOne) before any of these run.
 *
 * Aggregation happens in SQL (count FILTER, avg, date_bin) rather than by
 * loading rows into Node: the database does it next to the data, with the
 * (monitor_id, checked_at) index, and only a few dozen numbers cross the wire.
 */
@Injectable()
export class MonitorStatsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Incident) private readonly incidents: Repository<Incident>,
  ) {}

  async overview(monitorIds: string[]): Promise<MonitorOverview[]> {
    if (monitorIds.length === 0) return [];

    const totals: { monitor_id: string; up: number; total: number; avg_ms: number | null }[] =
      await this.dataSource.query(
        `SELECT monitor_id,
                count(*) FILTER (WHERE is_up)::int                   AS up,
                count(*)::int                                        AS total,
                round(avg(response_time_ms) FILTER (WHERE is_up))::int AS avg_ms
           FROM checks
          WHERE monitor_id = ANY($1::uuid[])
            AND checked_at >= now() - interval '24 hours'
          GROUP BY monitor_id`,
        [monitorIds],
      );

    // LATERAL = "for each monitor, run this subquery". Each one is an index-only
    // walk backwards over (monitor_id, checked_at) that stops after 30 rows,
    // instead of a window function over every check in the table.
    const recent: { monitor_id: string; checked_at: Date; is_up: boolean; response_time_ms: number | null }[] =
      await this.dataSource.query(
        `SELECT m.id AS monitor_id, c.checked_at, c.is_up, c.response_time_ms
           FROM unnest($1::uuid[]) AS m(id)
           CROSS JOIN LATERAL (
             SELECT checked_at, is_up, response_time_ms
               FROM checks
              WHERE monitor_id = m.id
              ORDER BY checked_at DESC
              LIMIT ${RECENT_CHECKS}
           ) c`,
        [monitorIds],
      );

    return monitorIds.map((id) => {
      const t = totals.find((r) => r.monitor_id === id);
      return {
        monitorId: id,
        uptime24h: t ? uptimePct(t.up, t.total) : null,
        avgResponseMs24h: t?.avg_ms ?? null,
        recent: recent
          .filter((r) => r.monitor_id === id)
          .reverse()
          .map((r) => ({
            at: new Date(r.checked_at).toISOString(),
            up: r.is_up,
            responseTimeMs: r.response_time_ms,
          })),
      };
    });
  }

  async stats(monitorId: string): Promise<MonitorStats> {
    const [row]: {
      up_24h: number; total_24h: number; up_7d: number; total_7d: number;
      up_30d: number; total_30d: number; avg_ms_24h: number | null;
    }[] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE is_up AND checked_at >= now() - interval '24 hours')::int AS up_24h,
              count(*) FILTER (WHERE checked_at >= now() - interval '24 hours')::int           AS total_24h,
              count(*) FILTER (WHERE is_up AND checked_at >= now() - interval '7 days')::int   AS up_7d,
              count(*) FILTER (WHERE checked_at >= now() - interval '7 days')::int             AS total_7d,
              count(*) FILTER (WHERE is_up)::int                                               AS up_30d,
              count(*)::int                                                                    AS total_30d,
              round(avg(response_time_ms) FILTER (
                WHERE is_up AND checked_at >= now() - interval '24 hours'))::int               AS avg_ms_24h
         FROM checks
        WHERE monitor_id = $1
          AND checked_at >= now() - interval '30 days'`,
      [monitorId],
    );

    const open = await this.incidents
      .createQueryBuilder('i')
      .where('i.monitorId = :monitorId AND i.resolvedAt IS NULL', { monitorId })
      .getOne();

    return {
      uptime: {
        h24: uptimePct(row.up_24h, row.total_24h),
        d7: uptimePct(row.up_7d, row.total_7d),
        d30: uptimePct(row.up_30d, row.total_30d),
      },
      avgResponseMs24h: row.avg_ms_24h,
      checks24h: row.total_24h,
      openIncident: open ? { id: open.id, cause: open.cause, openedAt: open.openedAt } : null,
    };
  }

  async history(monitorId: string, range: HistoryRange): Promise<HistoryBucket[]> {
    const { span, bucket } = RANGES[range];
    // date_bin (Postgres 14+) snaps each timestamp down to the start of its
    // bucket, e.g. 10:07 → 10:00 for 15-minute buckets. Empty buckets simply
    // don't appear; the frontend draws those as gaps.
    const rows: { t: Date; avg_ms: number | null; up: number; total: number }[] =
      await this.dataSource.query(
        `SELECT date_bin($2::interval, checked_at, TIMESTAMPTZ '2000-01-01') AS t,
                round(avg(response_time_ms) FILTER (WHERE is_up))::int     AS avg_ms,
                count(*) FILTER (WHERE is_up)::int                         AS up,
                count(*)::int                                              AS total
           FROM checks
          WHERE monitor_id = $1
            AND checked_at >= now() - $3::interval
          GROUP BY 1
          ORDER BY 1`,
        [monitorId, bucket, span],
      );
    return rows.map((r) => ({
      t: new Date(r.t).toISOString(),
      avgResponseMs: r.avg_ms,
      up: r.up,
      total: r.total,
    }));
  }

  listIncidents(monitorId: string, limit = 20): Promise<Incident[]> {
    return this.incidents.find({
      where: { monitorId },
      order: { openedAt: 'DESC' },
      take: limit,
    });
  }
}
