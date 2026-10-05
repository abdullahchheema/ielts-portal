import { band as fmt } from '@/lib/format';

/**
 * The one place an estimated band is shown. It never invents a number: with missing skills it says
 * which skill is missing, and with no data it says so.
 */
export function EstimatedBand({ value, missingSkills = [], pointCount, trend, delta, label = 'Estimated overall band' }: {
  value: number | null; missingSkills?: string[]; pointCount?: number; trend?: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA'; delta?: number | null; label?: string;
}) {
  const arrow = trend === 'IMPROVING' ? '▲' : trend === 'DECLINING' ? '▼' : trend === 'STABLE' ? '▬' : null;
  return (
    <div>
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      {value === null ? (
        <p className="mt-1 text-sm text-fg-muted">
          Not available{missingSkills.length ? ` — no ${missingSkills.map((s) => s.toLowerCase()).join(', ')} score yet` : ''}.
        </p>
      ) : (
        <p className="mt-1 flex items-baseline gap-2">
          <span className="font-display text-3xl font-semibold tabular-nums text-fg">{fmt(value)}</span>
          {arrow && trend !== 'INSUFFICIENT_DATA' && delta !== null && delta !== undefined && (
            <span className="text-sm tabular-nums text-fg-muted">{arrow} {delta > 0 ? '+' : ''}{delta}</span>
          )}
        </p>
      )}
      {pointCount !== undefined && value !== null && (
        <p className="mt-1 text-xs text-fg-subtle">Based on {pointCount} {pointCount === 1 ? 'score' : 'scores'}</p>
      )}
    </div>
  );
}
