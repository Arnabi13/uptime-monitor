import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { uptimePct } from '../monitors/monitor-stats.service';

/** Days of history on the public page (and the uptime % beside each monitor). */
export const STATUS_PAGE_DAYS = 30;
const DEFAULT_TITLE = 'Service status';
const SLUG_PATTERN = /^[a-z0-9]{6,32}$/;

export type OverallStatus = 'operational' | 'partial_outage' | 'major_outage' | 'no_monitors';

export interface StatusPageSettings {
  slug: string;
  title: string;
  publicMonitors: number;
}

export interface PublicStatusPage {
  title: string;
  overall: OverallStatus;
  generatedAt: string;
  monitors: {
    name: string;
    status: 'up' | 'down' | 'pending';
    uptime30d: number | null;
    /** One entry per UTC day, oldest first; days with no checks have total 0. */
    days: { date: string; up: number; total: number }[];
  }[];
  incidents: { monitorName: string; openedAt: string; resolvedAt: string | null }[];
}

/**
 * The public status page shows ONLY what a monitor's owner opted into
 * (is_public), and only the name and status — never the URL, the failure
 * cause, the owner's email or any ids. Anyone with the link can see it, so
 * it's designed to leak nothing an owner wouldn't put on a public page.
 */
@Injectable()
export class StatusPageService {
  constructor(private readonly dataSource: DataSource) {}

  async settings(userId: string): Promise<StatusPageSettings> {
    const [row]: { status_slug: string; status_page_title: string | null; public_monitors: number }[] =
      await this.dataSource.query(
        `SELECT u.status_slug, u.status_page_title,
                (SELECT count(*)::int FROM monitors m WHERE m.user_id = u.id AND m.is_public) AS public_monitors
           FROM users u WHERE u.id = $1`,
        [userId],
      );
    return {
      slug: row.status_slug,
      title: row.status_page_title ?? DEFAULT_TITLE,
      publicMonitors: row.public_monitors,
    };
  }

  async updateTitle(userId: string, title: string): Promise<StatusPageSettings> {
    const trimmed = title.trim();
    await this.dataSource.query(`UPDATE users SET status_page_title = $2 WHERE id = $1`, [
      userId,
      trimmed === '' ? null : trimmed,
    ]);
    return this.settings(userId);
  }

  /** New random slug: the old link stops working immediately. */
  async rotateSlug(userId: string): Promise<StatusPageSettings> {
    await this.dataSource.query(
      `UPDATE users SET status_slug = substr(md5(random()::text || clock_timestamp()::text), 1, 12)
        WHERE id = $1`,
      [userId],
    );
    return this.settings(userId);
  }

  async publicPage(slug: string): Promise<PublicStatusPage> {
    // Malformed slugs get the same 404 as unknown ones, without touching the DB.
    if (!SLUG_PATTERN.test(slug)) throw new NotFoundException('Status page not found');

    const [owner]: { id: string; status_page_title: string | null }[] = await this.dataSource.query(
      `SELECT id, status_page_title FROM users WHERE status_slug = $1`,
      [slug],
    );
    if (!owner) throw new NotFoundException('Status page not found');

    const monitors: { id: string; name: string; status: string }[] = await this.dataSource.query(
      `SELECT id, name, status FROM monitors
        WHERE user_id = $1 AND is_public AND is_active
        ORDER BY name`,
      [owner.id],
    );
    const ids = monitors.map((m) => m.id);

    const daily: { monitor_id: string; day: string; up: number; total: number }[] = ids.length
      ? await this.dataSource.query(
          `SELECT monitor_id,
                  to_char(date_trunc('day', checked_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
                  count(*) FILTER (WHERE is_up)::int AS up,
                  count(*)::int AS total
             FROM checks
            WHERE monitor_id = ANY($1::uuid[])
              AND checked_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                               - interval '${STATUS_PAGE_DAYS - 1} days'
            GROUP BY 1, 2`,
          [ids],
        )
      : [];

    const incidents: { monitor_name: string; opened_at: Date; resolved_at: Date | null }[] = ids.length
      ? await this.dataSource.query(
          `SELECT m.name AS monitor_name, i.opened_at, i.resolved_at
             FROM incidents i JOIN monitors m ON m.id = i.monitor_id
            WHERE i.monitor_id = ANY($1::uuid[])
              AND (i.resolved_at IS NULL OR i.opened_at >= now() - interval '14 days')
            ORDER BY i.opened_at DESC
            LIMIT 20`,
          [ids],
        )
      : [];

    const dayKeys = lastNDays(STATUS_PAGE_DAYS);
    const result = monitors.map((m) => {
      const days = dayKeys.map((date) => {
        const d = daily.find((r) => r.monitor_id === m.id && r.day === date);
        return { date, up: d?.up ?? 0, total: d?.total ?? 0 };
      });
      const up = days.reduce((s, d) => s + d.up, 0);
      const total = days.reduce((s, d) => s + d.total, 0);
      return {
        name: m.name,
        status: (m.status === 'up' || m.status === 'down' ? m.status : 'pending') as
          | 'up'
          | 'down'
          | 'pending',
        uptime30d: uptimePct(up, total),
        days,
      };
    });

    return {
      title: owner.status_page_title ?? DEFAULT_TITLE,
      overall: overallStatus(result.map((m) => m.status)),
      generatedAt: new Date().toISOString(),
      monitors: result,
      incidents: incidents.map((i) => ({
        monitorName: i.monitor_name,
        openedAt: new Date(i.opened_at).toISOString(),
        resolvedAt: i.resolved_at ? new Date(i.resolved_at).toISOString() : null,
      })),
    };
  }
}

export function overallStatus(statuses: string[]): OverallStatus {
  if (statuses.length === 0) return 'no_monitors';
  const down = statuses.filter((s) => s === 'down').length;
  if (down === 0) return 'operational';
  return down === statuses.length ? 'major_outage' : 'partial_outage';
}

/** ['2026-09-25', …, today] in UTC. */
function lastNDays(n: number): string[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today.getTime() - (n - 1 - i) * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
}
