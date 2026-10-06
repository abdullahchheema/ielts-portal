import { cx } from '@/lib/cx';
import { Card } from './display';
import { ProgressBar } from './feedback';

/** One criterion per row, with its score and a bar. Scores are 0–9 in half bands. */
export function ScoreBreakdown({ items, max = 9 }: { items: { label: string; score: number | null }[]; max?: number }) {
  return (
    <dl className="space-y-3">
      {items.map((it) => (
        <div key={it.label}>
          <div className="flex justify-between text-sm">
            <dt className="text-fg-muted">{it.label}</dt>
            <dd className="font-medium tabular-nums text-fg">{it.score ?? '—'}</dd>
          </div>
          <ProgressBar value={it.score === null ? 0 : Math.round((it.score / max) * 100)} label={`${it.label} ${it.score ?? 'not scored'}`} />
        </div>
      ))}
    </dl>
  );
}

/** A skill's current estimate with a direction arrow against the previous estimate. */
export function SkillScoreCard({ skill, band, previous, target }: {
  skill: string; band: number | null; previous?: number | null; target?: number | null;
}) {
  const delta = band !== null && previous !== null && previous !== undefined ? Math.round((band - previous) * 2) / 2 : null;
  return (
    <Card className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{skill}</p>
      <p className="font-display text-2xl font-semibold tabular-nums text-fg">{band ?? '—'}</p>
      <p className="text-xs text-fg-muted">
        {delta === null ? 'Not enough attempts for a trend' : (
          <span className={cx(delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-fg-muted')}>
            {delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} {Math.abs(delta)} since last
          </span>
        )}
        {target !== null && target !== undefined && <span> · target {target}</span>}
      </p>
    </Card>
  );
}
