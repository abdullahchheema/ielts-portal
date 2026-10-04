'use client';

import { useMemo, useState } from 'react';
import { band as fmtBand, date } from '@/lib/format';

export interface BandPoint { at: string | null; band: number; title: string }

const W = 480;
const H = 170;
const PAD = { l: 34, r: 14, t: 12, b: 26 };

/**
 * One measure, one axis: band over time for a single skill. The heading names the series, so no legend box;
 * every point is hoverable/focusable, and a table view carries the same data for screen readers.
 */
export function BandChart({ skill, points, target }: { skill: string; points: BandPoint[]; target?: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const g = useMemo(() => {
    const vals = points.map((p) => p.band).concat(target ? [target] : []);
    const lo = Math.max(0, Math.floor((Math.min(...vals, 9) - 0.5) * 2) / 2 - 0.5);
    const hi = Math.min(9, Math.ceil((Math.max(...vals, 0) + 0.5) * 2) / 2);
    const t = points.map((p) => (p.at ? new Date(p.at).getTime() : 0));
    const t0 = Math.min(...t); const t1 = Math.max(...t);
    const x = (i: number) => PAD.l + (points.length === 1 || t1 === t0 ? (W - PAD.l - PAD.r) / 2 : ((t[i] - t0) / (t1 - t0)) * (W - PAD.l - PAD.r));
    const y = (b: number) => PAD.t + (1 - (b - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);
    const ticks: number[] = []; for (let b = Math.ceil(lo); b <= hi; b += 1) ticks.push(b);
    return { x, y, ticks, lo, hi };
  }, [points, target]);

  if (points.length === 0) {
    return <div className="rounded-lg border border-dashed border-border-strong bg-surface p-4 text-sm text-fg-muted"><strong className="text-fg">{skill}</strong><br />No scores yet.</div>;
  }
  const latest = points[points.length - 1];
  const best = Math.max(...points.map((p) => p.band));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${g.x(i).toFixed(1)},${g.y(p.band).toFixed(1)}`).join(' ');
  const h = hover !== null ? points[hover] : null;

  return (
    <figure className="rounded-lg bg-surface p-5 shadow-xs ring-1 ring-border">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display font-semibold text-fg">{skill}</span>
        <span className="text-xs text-fg-muted">Latest <strong>{fmtBand(latest.band)}</strong> · Best <strong>{fmtBand(best)}</strong></span>
      </figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${skill} band history: latest ${fmtBand(latest.band)}, best ${fmtBand(best)}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            let nearest = 0; let d = Infinity;
            points.forEach((_, i) => { const dd = Math.abs(g.x(i) - px); if (dd < d) { d = dd; nearest = i; } });
            setHover(nearest);
          }}>
          {g.ticks.map((b) => (
            <g key={b}>
              <line x1={PAD.l} x2={W - PAD.r} y1={g.y(b)} y2={g.y(b)} className="stroke-border" strokeWidth={1} />
              <text x={PAD.l - 6} y={g.y(b) + 4} textAnchor="end" fontSize={11} className="fill-fg-subtle">{b.toFixed(1)}</text>
            </g>
          ))}
          {target ? <g><line x1={PAD.l} x2={W - PAD.r} y1={g.y(target)} y2={g.y(target)} className="stroke-fg-subtle" strokeWidth={1} strokeDasharray="4 4" /><text x={W - PAD.r} y={g.y(target) - 4} textAnchor="end" fontSize={11} className="fill-fg-muted">Target {fmtBand(target)}</text></g> : null}
          {points.length > 1 && <path d={path} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {h && <line x1={g.x(hover!)} x2={g.x(hover!)} y1={PAD.t} y2={H - PAD.b} className="stroke-border-strong" strokeWidth={1} />}
          {points.map((p, i) => (
            <g key={i}>
              {/* larger transparent target than the visible 8px marker */}
              <circle cx={g.x(i)} cy={g.y(p.band)} r={14} fill="transparent" tabIndex={0} onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={`${p.title}: band ${fmtBand(p.band)}${p.at ? `, ${date(p.at)}` : ''}`} />
              <circle cx={g.x(i)} cy={g.y(p.band)} r={hover === i ? 6 : 4.5} className="fill-primary stroke-surface" strokeWidth={2} pointerEvents="none" />
            </g>
          ))}
          <text x={PAD.l} y={H - 6} fontSize={11} className="fill-fg-muted">{date(points[0].at)}</text>
          {points.length > 1 && <text x={W - PAD.r} y={H - 6} textAnchor="end" fontSize={11} className="fill-fg-muted">{date(latest.at)}</text>}
        </svg>
        {h && (
          <div role="status" className="pointer-events-none absolute -translate-x-1/2 rounded-md bg-fg px-2.5 py-1.5 text-xs text-surface shadow-lg" style={{ left: `${(g.x(hover!) / W) * 100}%`, top: 0 }}>
            <div className="font-semibold">Band {fmtBand(h.band)}</div><div className="text-surface/75">{h.title}</div><div className="text-surface/60">{date(h.at)}</div>
          </div>
        )}
      </div>
      <button type="button" className="mt-2 text-xs font-medium text-primary underline underline-offset-2" aria-expanded={table} onClick={() => setTable((v) => !v)}>{table ? 'Hide table' : 'Show as table'}</button>
      {table && (
        <table className="mt-2 w-full text-left text-xs">
          <thead><tr className="text-fg-muted"><th className="py-1 font-medium">Date</th><th className="font-medium">Source</th><th className="text-right font-medium">Band</th></tr></thead>
          <tbody>{points.map((p, i) => <tr key={i} className="border-t border-border"><td className="py-1">{date(p.at)}</td><td>{p.title}</td><td className="text-right font-medium">{fmtBand(p.band)}</td></tr>)}</tbody>
        </table>
      )}
    </figure>
  );
}
