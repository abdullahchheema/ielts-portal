'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Alert, Empty, Loading, PageHeader, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { label } from '@/lib/format';
import { primaryApplication, useApplications } from '@/components/student';

interface TreeItem {
  id: string; title: string; contentType: string; state: string; isRequired: boolean; estimatedMinutes: number | null;
  module: string | null; track: string; skillKey: string | null; activityKind: string; difficulty: string | null; isTimed: boolean;
}
interface TreeSection { id: string; title: string; items: TreeItem[]; children: TreeSection[] }

const PRACTICE_KINDS = new Set(['PRACTICE', 'TIMED_PRACTICE', 'GUIDED_EXERCISE']);
const MODULES = ['LISTENING', 'READING', 'WRITING', 'SPEAKING'] as const;
const DIFFICULTIES = ['FOUNDATION', 'EASY', 'MEDIUM', 'HARD'] as const;

function flatten(s: TreeSection): TreeItem[] { return [...s.items, ...s.children.flatMap(flatten)]; }

export default function PracticePage() {
  const apps = useApplications();
  const app = primaryApplication(apps.data);
  const enrolled = !!app && ['ACTIVE', 'COMPLETED'].includes(app.status);
  const course = useQuery({ queryKey: ['course', app?.id], enabled: enrolled, queryFn: () => api<{ sections: TreeSection[] }>(`/me/courses/${app!.id}`) });

  const [module, setModule] = useState<string>('ALL');
  const [difficulty, setDifficulty] = useState<string>('ALL');
  const [timed, setTimed] = useState<string>('ALL');
  const [status, setStatus] = useState<string>('ALL');

  const items = useMemo(() => {
    const all = (course.data?.sections ?? []).flatMap(flatten).filter((i) => PRACTICE_KINDS.has(i.activityKind));
    return all.filter((i) =>
      (module === 'ALL' || i.module === module) &&
      (difficulty === 'ALL' || i.difficulty === difficulty) &&
      (timed === 'ALL' || (timed === 'TIMED' ? i.isTimed : !i.isTimed)) &&
      (status === 'ALL' || (status === 'DONE' ? i.state === 'COMPLETED' : i.state !== 'COMPLETED' && i.state !== 'LOCKED')),
    );
  }, [course.data, module, difficulty, timed, status]);

  if (apps.isLoading) return <Loading />;

  return (
    <>
      <PageHeader title="Practice" subtitle="Start practice directly, without navigating the full course hierarchy. Filter by module, difficulty, and timed or untimed." />
      {!enrolled ? (
        <Empty>Enroll in the course to access the practice library.</Empty>
      ) : course.isLoading ? <Loading /> : course.isError ? <Alert>{errorMessage(course.error)}</Alert> : (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <Select value={module} onChange={(e) => setModule(e.target.value)} className="w-auto">
              <option value="ALL">All modules</option>
              {MODULES.map((m) => <option key={m} value={m}>{label(m)}</option>)}
            </Select>
            <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="w-auto">
              <option value="ALL">Any difficulty</option>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{label(d)}</option>)}
            </Select>
            <Select value={timed} onChange={(e) => setTimed(e.target.value)} className="w-auto">
              <option value="ALL">Timed or untimed</option>
              <option value="TIMED">Timed only</option>
              <option value="UNTIMED">Untimed only</option>
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
              <option value="ALL">Any status</option>
              <option value="NOT_DONE">Not yet completed</option>
              <option value="DONE">Completed</option>
            </Select>
          </div>
          {items.length === 0 ? <Empty>No practice items match these filters yet. Try widening your filters.</Empty> : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <div className="font-medium text-slate-900">{i.title}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {i.module && label(i.module)}{i.difficulty ? ` · ${label(i.difficulty)}` : ''}{i.isTimed ? ' · Timed' : ''}{i.estimatedMinutes ? ` · ${i.estimatedMinutes} min` : ''}
                    </div>
                  </div>
                  {i.state === 'LOCKED' ? <span className="text-xs text-slate-400">Locked</span> : (
                    <Link href={`/student/learn/${app!.id}?item=${i.id}`} className="shrink-0 font-medium text-indigo-700 hover:underline">
                      {i.state === 'COMPLETED' ? 'Review' : i.state === 'IN_PROGRESS' ? 'Continue' : 'Start'}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
