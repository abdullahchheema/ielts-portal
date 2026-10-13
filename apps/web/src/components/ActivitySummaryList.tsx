import { CalendarCheck, CheckCircle2, FileText, LogIn, Target } from 'lucide-react';
import { Card, Empty } from '@/components/ui';
import { date } from '@/lib/format';

export interface DailyActivityRow {
  date: string; loginCount: number; mockTestsTaken: number; lessonsOpened: number;
  submissionsMade: number; classesAttended: number; lastActiveAt: string | null;
}

const METRICS: { key: keyof DailyActivityRow; icon: typeof LogIn; label: string }[] = [
  { key: 'loginCount', icon: LogIn, label: 'Logins' },
  { key: 'lessonsOpened', icon: CheckCircle2, label: 'Lessons opened' },
  { key: 'mockTestsTaken', icon: Target, label: 'Mock tests' },
  { key: 'submissionsMade', icon: FileText, label: 'Submissions' },
  { key: 'classesAttended', icon: CalendarCheck, label: 'Classes attended' },
];

/**
 * A day-by-day activity count — not a session/page-view log, just "was this person active and what
 * did they do." Newest day first; a day with every count at zero is shown, not hidden, so a quiet
 * stretch is visible rather than looking like missing data.
 */
export function ActivitySummaryList({ rows }: { rows: DailyActivityRow[] }) {
  const reversed = [...rows].reverse();
  const allZero = rows.every((r) => METRICS.every((m) => r[m.key] === 0));
  if (allZero) return <Empty title="No activity recorded yet">Daily activity appears here once this person logs in and starts using the portal.</Empty>;

  return (
    <div className="space-y-2">
      {reversed.map((r) => {
        const total = METRICS.reduce((sum, m) => sum + (r[m.key] as number), 0);
        return (
          <Card key={r.date} className={total === 0 ? 'opacity-50' : undefined}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-fg">{date(r.date)}</p>
              {total === 0 ? <span className="text-xs text-fg-subtle">No activity</span> : (
                <div className="flex flex-wrap items-center gap-4">
                  {METRICS.filter((m) => (r[m.key] as number) > 0).map((m) => (
                    <span key={m.key} className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                      <m.icon className="size-3.5 text-primary" strokeWidth={1.75} />
                      {r[m.key] as number} {m.label.toLowerCase()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
