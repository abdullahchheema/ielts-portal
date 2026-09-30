import { LinkButton } from '@/components/ui';
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
  return (
    <div className="flex flex-col rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="text-lg font-semibold text-slate-900">{batch.name}</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${running ? 'bg-blue-50 text-blue-700 ring-blue-600/20' : 'bg-green-50 text-green-700 ring-green-600/20'}`}>{running ? 'Running — join now' : 'Open for enrollment'}</span>
      </div>
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-slate-500">{running ? 'Started' : 'Starts'}</dt><dd className="font-medium text-slate-900">{date(batch.startAt)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-500">Classes</dt><dd className="text-right font-medium text-slate-900">{batch.days.length ? batch.days.map((d) => DAY[d] ?? d).join(', ') : 'To be announced'}{batch.classTime ? ` · ${batch.classTime}` : ''}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-500">Format</dt><dd className="font-medium text-slate-900">{label(batch.deliveryMode)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-500">Teacher</dt><dd className={`text-right font-medium ${batch.mentorAssigned ? 'text-slate-900' : 'text-slate-500'}`}>{batch.mentorAssigned ? batch.mentors.map((m) => m.name).join(', ') : 'Not assigned yet'}</dd></div>
      </dl>
      {batch.description && <p className="mt-3 text-sm text-slate-600">{batch.description}</p>}
      <div className="mt-5 pt-1"><LinkButton href={`/enroll/${batch.id}`} className="w-full">Enroll Now</LinkButton></div>
    </div>
  );
}
