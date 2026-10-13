'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Badge, Card, Empty, Loading, PageHeader, Section } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date, label } from '@/lib/format';

interface TodayItem {
  contentItemId?: string; assignmentId?: string; title?: string; estimatedMinutes?: number | null;
  dueAt?: string | null; classification?: string; skillKey?: string; reason?: string; module?: string | null;
  enrollmentId: string | null; source: 'TEACHER_ASSIGNED' | 'PERSONALISED' | 'REVISION_DUE' | 'OPTIONAL_PRACTICE';
}
interface ClassToday { id: string; topic: string; startsAt: string; endsAt: string; batch: string; mentor: string | null; status: string; meetingUrl: string | null }
interface Today { requiredToday: TodayItem[]; classesToday: ClassToday[]; recommended: TodayItem[]; revisionDue: TodayItem[]; optionalAssigned: TodayItem[]; optionalPractice: TodayItem[] }

const SOURCE_TEXT: Record<string, string> = {
  TEACHER_ASSIGNED: 'Teacher Assigned', PERSONALISED: 'Personalised', REVISION_DUE: 'Revision Due', OPTIONAL_PRACTICE: 'Optional Practice',
};
const REASON_TEXT: Record<string, string> = {
  FOUNDATIONAL_LESSON: 'Foundational lesson', WORKED_EXAMPLE: 'Worked example', GUIDED_EXERCISE: 'Guided exercise', INDEPENDENT_PRACTICE: 'Independent practice', MASTERY_CHECK: 'Mastery check',
};

function ItemRow({ item }: { item: TodayItem }) {
  const href = item.contentItemId && item.enrollmentId ? `/student/learn/${item.enrollmentId}?item=${item.contentItemId}` : null;
  return (
    <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-900">{item.title ?? 'Untitled activity'}</span>
          <Badge status={item.source} tone={item.source === 'TEACHER_ASSIGNED' ? 'blue' : item.source === 'REVISION_DUE' ? 'amber' : 'slate'} text={SOURCE_TEXT[item.source]} />
        </div>
        <div className="mt-0.5 text-xs text-slate-500">
          {item.reason && <>{REASON_TEXT[item.reason] ?? label(item.reason)} · </>}
          {item.classification && item.classification !== 'GENERAL' && <>{label(item.classification)} · </>}
          {item.estimatedMinutes ? `${item.estimatedMinutes} min` : null}
          {item.dueAt && <> · Due {date(item.dueAt, true)}</>}
        </div>
      </div>
      {href ? <Link href={href} className="shrink-0 font-medium text-indigo-700 hover:underline">Start</Link> : <span className="shrink-0 text-xs text-slate-400">Not yet available</span>}
    </li>
  );
}

export default function TodayPage() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['today'], queryFn: () => api<Today>('/me/today') });

  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>{errorMessage(error)}</Alert>;

  const nothingAtAll = !data.requiredToday.length && !data.classesToday.length && !data.recommended.length && !data.revisionDue.length && !data.optionalAssigned.length && !data.optionalPractice.length;

  return (
    <>
      <PageHeader title="Today" subtitle="What should you work on today?" />
      {nothingAtAll && <Empty>Nothing is scheduled or recommended for you right now. Visit My Course to start learning, or take a Diagnostic test so we can personalise your path.</Empty>}

      {data.requiredToday.length > 0 && (
        <Card className="mb-4">
          <Section title="Required Today"><ul className="divide-y divide-slate-100">{data.requiredToday.map((i) => <ItemRow key={i.assignmentId} item={i} />)}</ul></Section>
        </Card>
      )}

      {data.classesToday.length > 0 && (
        <Card className="mb-4">
          <Section title="Classes Today">
            <ul className="divide-y divide-slate-100">
              {data.classesToday.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <div className="font-medium text-slate-900">{c.topic}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{c.batch}{c.mentor ? ` · ${c.mentor}` : ''} · {date(c.startsAt, true)}–{date(c.endsAt, true)}</div>
                  </div>
                  {c.meetingUrl ? <a href={c.meetingUrl} target="_blank" rel="noreferrer" className="shrink-0 font-medium text-indigo-700 hover:underline">Join Zoom Class</a> : <span className="shrink-0 text-xs text-slate-400">Opens 15 min before</span>}
                </li>
              ))}
            </ul>
          </Section>
        </Card>
      )}

      {data.recommended.length > 0 && (
        <Card className="mb-4">
          <Section title="Recommended For You"><ul className="divide-y divide-slate-100">{data.recommended.map((i) => <ItemRow key={i.contentItemId} item={i} />)}</ul></Section>
        </Card>
      )}

      {data.revisionDue.length > 0 && (
        <Card className="mb-4">
          <Section title="Revision Due"><ul className="divide-y divide-slate-100">{data.revisionDue.map((i) => <ItemRow key={i.contentItemId} item={i} />)}</ul></Section>
        </Card>
      )}

      {(data.optionalAssigned.length > 0 || data.optionalPractice.length > 0) && (
        <Card>
          <Section title="Optional Practice">
            <ul className="divide-y divide-slate-100">
              {data.optionalAssigned.map((i) => <ItemRow key={i.assignmentId} item={i} />)}
              {data.optionalPractice.map((i) => <ItemRow key={i.contentItemId} item={i} />)}
            </ul>
          </Section>
        </Card>
      )}
    </>
  );
}
