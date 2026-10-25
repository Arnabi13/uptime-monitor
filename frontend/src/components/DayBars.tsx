import { formatDay, formatUptime } from '../lib/format';

type Day = { date: string; up: number; total: number };

function level(day: Day): 'none' | 'good' | 'minor' | 'bad' {
  if (day.total === 0) return 'none';
  const pct = (day.up / day.total) * 100;
  if (pct >= 99.9) return 'good';
  if (pct >= 95) return 'minor';
  return 'bad';
}

/** 30 days, one bar each, coloured by that day's uptime. Used on the public page. */
export function DayBars({ days }: { days: Day[] }) {
  return (
    <div className="um-days">
      <div className="um-days__bars">
        {days.map((d) => {
          const lv = level(d);
          const text =
            lv === 'none'
              ? `${formatDay(d.date)}: no data`
              : `${formatDay(d.date)}: ${formatUptime(Math.round((d.up / d.total) * 10000) / 100)} up`;
          return <span key={d.date} className={`um-days__bar is-${lv}`} role="img" title={text} aria-label={text} />;
        })}
      </div>
      <div className="um-days__axis" aria-hidden="true">
        <span>{days.length} days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}
