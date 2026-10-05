import { Badge } from '@/components/ui';

export type RiskLevelValue = 'GREEN' | 'YELLOW' | 'RED';

const LABEL: Record<RiskLevelValue, string> = { GREEN: 'On track', YELLOW: 'Needs attention', RED: 'At risk' };
const TONE: Record<RiskLevelValue, 'green' | 'amber' | 'red'> = { GREEN: 'green', YELLOW: 'amber', RED: 'red' };

/**
 * Risk level with its reasons. `reasons` is required, so a level can never be shown without the
 * explanation behind it. The label is text, so colour is never the only signal.
 */
export function RiskBadge({ level, reasons, showReasons = false }: { level: RiskLevelValue; reasons: string[]; showReasons?: boolean }) {
  return (
    <span className="inline-flex flex-col items-start gap-1.5">
      <Badge status={level} tone={TONE[level]} text={LABEL[level]} />
      {showReasons && level !== 'GREEN' && reasons.length > 0 && (
        <ul className="list-inside list-disc text-xs leading-relaxed text-fg-muted">
          {reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
    </span>
  );
}
