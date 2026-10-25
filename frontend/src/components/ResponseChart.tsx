import { useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryBucket, HistoryRange } from '../api/types';
import { formatAxisMs, formatDateTime, formatMs, formatUptime } from '../lib/format';

const SPAN_MS: Record<HistoryRange, number> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};
// Must match the bucket sizes in the API's MonitorStatsService.
const BUCKET_MS: Record<HistoryRange, number> = {
  '24h': 15 * 60_000,
  '7d': 2 * 3600_000,
  '30d': 8 * 3600_000,
};

const HEIGHT = 220;
const PAD = { top: 16, right: 12, bottom: 28, left: 52 };
const FAIL_BAND = 6;

/** Rounds the y-axis top up to a tidy number: 437 → 500, 1830 → 2000. */
function niceCeil(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 2.5, 5, 10];
  return steps.map((s) => s * magnitude).find((v) => v >= value) ?? 10 * magnitude;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Hand-rolled SVG instead of a chart library: one line, one area, a hover
 * readout. A library would add ~100 KB to the bundle for that.
 *
 * Gaps (paused, or every check in a bucket failed so there's no response time)
 * break the line instead of drawing a misleading straight segment across them.
 */
export function ResponseChart({ buckets, range }: { buckets: HistoryBucket[]; range: HistoryRange }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const end = Date.now();
    const start = end - SPAN_MS[range];
    const innerW = Math.max(0, width - PAD.left - PAD.right);
    const innerH = HEIGHT - PAD.top - PAD.bottom - FAIL_BAND - 4;
    const yMax = niceCeil(Math.max(0, ...buckets.map((b) => b.avgResponseMs ?? 0)) * 1.1);

    const x = (t: number) => PAD.left + ((t - start) / (end - start)) * innerW;
    const y = (ms: number) => PAD.top + innerH - (ms / yMax) * innerH;
    const points = buckets.map((b) => {
      const t = new Date(b.t).getTime() + BUCKET_MS[range] / 2; // plot at bucket centre
      return { b, px: x(t), py: b.avgResponseMs === null ? null : y(b.avgResponseMs) };
    });

    // Split into continuous runs.
    const runs: { px: number; py: number }[][] = [];
    let prevT = -Infinity;
    for (const p of points) {
      const t = new Date(p.b.t).getTime();
      if (p.py === null) {
        prevT = -Infinity;
        continue;
      }
      if (t - prevT > BUCKET_MS[range] * 1.5 || runs.length === 0) runs.push([]);
      runs[runs.length - 1].push({ px: p.px, py: p.py });
      prevT = t;
    }
    const baseline = PAD.top + innerH;
    // A run with a single point (e.g. a brand-new monitor, or one bucket between
    // two gaps) has no segment to draw, so it would be invisible. Show a dot.
    const dots = runs.filter((r) => r.length === 1).map((r) => r[0]);
    const line = runs.map((r) => r.map((p, i) => `${i ? 'L' : 'M'}${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(''));
    const area = runs.map(
      (r) =>
        `M${r[0].px.toFixed(1)},${baseline}` +
        r.map((p) => `L${p.px.toFixed(1)},${p.py.toFixed(1)}`).join('') +
        `L${r[r.length - 1].px.toFixed(1)},${baseline}Z`,
    );

    const yTicks = [0, yMax / 2, yMax].map((v) => ({ v, py: y(v) }));
    // Fewer time labels on narrow screens so they don't collide.
    const tickCount = width < 520 ? 3 : 5;
    const xTicks = Array.from({ length: tickCount }, (_, i) => start + ((end - start) * i) / (tickCount - 1)).map(
      (t) => ({ t, px: x(t) }),
    );
    const barW = Math.max(2, (innerW * BUCKET_MS[range]) / (end - start) - 1);

    return { points, line, area, dots, yTicks, xTicks, baseline, barW, failY: baseline + 4 };
  }, [buckets, range, width]);

  const tickLabel = (t: number) =>
    new Intl.DateTimeFormat('en-IN', range === '24h' ? { hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short' }).format(t);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let best: number | null = null;
    let bestDist = Infinity;
    geometry.points.forEach((p, i) => {
      const d = Math.abs(p.px - mx);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setHover(bestDist < 40 ? best : null);
  }

  const hovered = hover === null ? null : geometry.points[hover];

  return (
    <div className="um-chart" ref={wrapRef}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label={`Average response time over the last ${range}`}
        >
          {geometry.yTicks.map(({ v, py }) => (
            <g key={v}>
              <line x1={PAD.left} x2={width - PAD.right} y1={py} y2={py} className="um-chart__grid" />
              <text x={PAD.left - 8} y={py} className="um-chart__label" textAnchor="end" dominantBaseline="middle">
                {formatAxisMs(v)}
              </text>
            </g>
          ))}
          {geometry.xTicks.map(({ t, px }, i, all) => (
            <text
              key={t}
              x={px}
              y={HEIGHT - 8}
              className="um-chart__label"
              textAnchor={i === 0 ? 'start' : i === all.length - 1 ? 'end' : 'middle'}
            >
              {i === all.length - 1 ? 'Now' : tickLabel(t)}
            </text>
          ))}
          {geometry.area.map((d, i) => (
            <path key={`a${i}`} d={d} className="um-chart__area" />
          ))}
          {geometry.line.map((d, i) => (
            <path key={`l${i}`} d={d} className="um-chart__line" />
          ))}
          {geometry.dots.map((p) => (
            <circle key={`d${p.px}`} cx={p.px} cy={p.py} r={3} className="um-chart__dot" />
          ))}
          {/* Failure band: a red tick under every bucket that had a failed check. */}
          {geometry.points
            .filter((p) => p.b.up < p.b.total)
            .map((p) => (
              <rect
                key={p.b.t}
                x={p.px - geometry.barW / 2}
                y={geometry.failY}
                width={geometry.barW}
                height={FAIL_BAND}
                rx={1}
                className="um-chart__fail"
              />
            ))}
          {hovered && (
            <g>
              <line x1={hovered.px} x2={hovered.px} y1={PAD.top} y2={geometry.baseline} className="um-chart__cursor" />
              {hovered.py !== null && <circle cx={hovered.px} cy={hovered.py} r={4} className="um-chart__dot" />}
            </g>
          )}
        </svg>
      )}
      {hovered && (
        <div
          className="um-chart__tip"
          style={{ left: Math.min(Math.max(hovered.px, 90), width - 90) }}
          aria-hidden="true"
        >
          <strong>{formatMs(hovered.b.avgResponseMs)}</strong>
          <span>{formatDateTime(hovered.b.t)}</span>
          <span>
            {hovered.b.up === hovered.b.total
              ? `${hovered.b.total} checks, all passed`
              : `${hovered.b.total - hovered.b.up} of ${hovered.b.total} failed (${formatUptime(
                  Math.round((hovered.b.up / hovered.b.total) * 10000) / 100,
                )} up)`}
          </span>
        </div>
      )}
    </div>
  );
}
