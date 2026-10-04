import { CalendarDays, Clock3, Monitor, UserRound } from 'lucide-react';
import { LinkButton } from '@/components/ui';
import { cx } from '@/lib/cx';
import { date, label } from '@/lib/format';

export interface PublicBatch {
  id: string; name: string; description: string | null; startAt: string; endAt: string | null; timezone: string;
  days: string[]; classTime: string | null; deliveryMode: string; status: string;
  mentorAssigned: boolean; mentors: { name: string; role: string }[];
}

const DAY: Record<string, string> = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };

/** A batch a visitor can join. A batch with no teacher yet is shown honestly and is just as enrollable. */
export function BatchCard({ batch }: { batch: PublicBatch }) {
  const running = batch.status === 'IN_PROGRESS';
  const rows = [
    { icon: CalendarDays, k: running ? 'Started' : 'Starts', v: date(batch.startAt), muted: false },
    { icon: Clock3, k: 'Classes', v: `${batch.days.length ? batch.days.map((d) => DAY[d] ?? d).join(', ') : 'To be announced'}${batch.classTime ? ` · ${batch.classTime}` : ''}`, muted: false },
    { icon: Monitor, k: 'Format', v: label(batch.deliveryMode), muted: false },
    { icon: UserRound, k: 'Teacher', v: batch.mentorAssigned ? batch.mentors.map((m) => m.name).join(', ') : 'Not assigned yet', muted: !batch.mentorAssigned },
  ];
  return (
    <article className="flex flex-col rounded-lg bg-surface p-6 shadow-xs ring-1 ring-border transition-shadow duration-200 hover:shadow-md">
      <div className="mb-5 flex items-start justify-between gap-3">
        <h3 className="font-display text-lg font-semibold leading-snug text-fg">{batch.name}</h3>
        <span className={cx('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', running ? 'bg-info-soft text-sky-800 ring-sky-600/20' : 'bg-success-soft text-green-800 ring-green-600/20')}>
          {running ? 'Running' : 'Open'}
        </span>
      </div>
      <dl className="space-y-3 text-sm">
        {rows.map((r) => (
          <div key={r.k} className="flex items-start gap-3">
            <r.icon aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
            <div className="min-w-0">
              <dt className="text-xs text-fg-muted">{r.k}</dt>
              <dd className={cx('font-medium', r.muted ? 'text-fg-muted' : 'text-fg')}>{r.v}</dd>
            </div>
          </div>
        ))}
      </dl>
      {batch.description && <p className="mt-5 border-t border-border pt-4 text-sm leading-relaxed text-fg-muted">{batch.description}</p>}
      <div className="mt-6">
        <LinkButton href={`/enroll/${batch.id}`} className="w-full">{running ? 'Join this batch' : 'Enroll in this batch'}</LinkButton>
      </div>
    </article>
  );
}
