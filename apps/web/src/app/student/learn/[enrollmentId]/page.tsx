'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Loading, ProgressBar } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date, label } from '@/lib/format';
import { AssessmentCard, AssessmentSummary, AssignmentPanel, AssignmentSummary } from '@/components/LessonExtras';

type State = 'LOCKED' | 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
interface Item {
  id: string; title: string; contentType: string; isRequired: boolean; estimatedMinutes: number | null; state: State;
  lock?: { code: string; reason: string; availableAt?: string };
}
interface Section { id: string; title: string; items: Item[]; children: Section[]; totals: { required: number; completedRequired: number } }
interface Course {
  enrollment: { id: string; progressPercent: string };
  course: { title: string };
  sections: Section[];
}
interface Content {
  id: string; title: string; contentType: string;
  content: { body?: string; url?: string; fileUrl?: string; fileName?: string };
  progress: { status: string; lastPosition: number | null };
  assessment?: AssessmentSummary;
  assignment?: AssignmentSummary;
}

const SELF_COMPLETABLE = ['TEXT', 'VIDEO', 'PDF', 'AUDIO', 'DOWNLOAD', 'EXTERNAL_LINK'];
const ICON: Record<State, string> = { COMPLETED: '✓', LOCKED: '🔒', IN_PROGRESS: '◐', NOT_STARTED: '○' };

function flatten(sections: Section[]): Item[] {
  return sections.flatMap((s) => [...s.items, ...flatten(s.children)]);
}

function Tree({ sections, activeId, onSelect, depth = 0 }: { sections: Section[]; activeId: string | null; onSelect: (i: Item) => void; depth?: number }) {
  return (
    <ul className={depth ? 'ml-3 border-l border-slate-200 pl-2' : 'space-y-4'}>
      {sections.map((s) => (
        <li key={s.id}>
          <p className="flex items-center justify-between px-1 text-sm font-semibold text-slate-800">
            <span>{s.title}</span>
            {s.totals.required > 0 && <span className="text-xs font-normal text-slate-500">{s.totals.completedRequired}/{s.totals.required}</span>}
          </p>
          <ul className="mt-1 space-y-0.5">
            {s.items.map((i) => (
              <li key={i.id}>
                <button
                  onClick={() => onSelect(i)}
                  aria-current={activeId === i.id ? 'true' : undefined}
                  className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm ${activeId === i.id ? 'bg-indigo-50 text-indigo-800' : i.state === 'LOCKED' ? 'text-slate-400 hover:bg-slate-50' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  <span aria-hidden className={i.state === 'COMPLETED' ? 'text-green-600' : ''}>{ICON[i.state]}</span>
                  <span className="flex-1">{i.title}<span className="sr-only"> ({i.state.toLowerCase().replace('_', ' ')})</span></span>
                </button>
              </li>
            ))}
          </ul>
          {s.children.length > 0 && <Tree sections={s.children} activeId={activeId} onSelect={onSelect} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function Viewer({ item, enrollmentId, next, onNext }: { item: Item; enrollmentId: string; next: Item | null; onNext: (i: Item) => void }) {
  const qc = useQueryClient();
  const sent = useRef<number>(0);
  const content = useQuery({
    queryKey: ['content', item.id],
    queryFn: () => api<Content>(`/content/${item.id}`),
    enabled: item.state !== 'LOCKED',
    staleTime: 4 * 60_000, // signed file URLs live 5 minutes
  });

  useEffect(() => { if (content.data && item.state === 'NOT_STARTED') api(`/content/${item.id}/start`, { method: 'POST' }).catch(() => undefined); }, [content.data, item.id, item.state]);

  const complete = useMutation({
    mutationFn: () => api(`/content/${item.id}/complete`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['course', enrollmentId] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
  });

  if (item.state === 'LOCKED') {
    return (
      <Card>
        <h2 className="text-xl font-semibold">{item.title}</h2>
        <div className="mt-4"><Alert kind="info">
          {item.lock?.reason ?? 'This lesson is locked.'}
          {item.lock?.availableAt && <> Available {date(item.lock.availableAt, true)}.</>}
        </Alert></div>
      </Card>
    );
  }
  if (content.isLoading) return <Loading />;
  if (content.isError || !content.data) return <Alert>{errorMessage(content.error)}</Alert>;
  const c = content.data;
  const canComplete = SELF_COMPLETABLE.includes(c.contentType);
  const done = item.state === 'COMPLETED' || complete.isSuccess;

  const reportProgress = (el: HTMLMediaElement) => {
    const now = Date.now();
    if (now - sent.current < 15_000 || !el.duration) return;
    sent.current = now;
    api(`/content/${item.id}/progress`, { method: 'POST', body: { progressPercent: Math.floor((el.currentTime / el.duration) * 100), lastPosition: Math.floor(el.currentTime), timeSpentSeconds: 15 } }).catch(() => undefined);
  };

  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label(c.contentType)}</p>
      <h2 className="mb-4 text-xl font-semibold">{c.title}</h2>

      {c.contentType === 'TEXT' && <div className="prose max-w-none whitespace-pre-wrap text-slate-800">{c.content.body ?? 'No content yet.'}</div>}

      {c.contentType === 'VIDEO' && (c.content.url
        ? /\.(mp4|webm|ogg)(\?|$)/i.test(c.content.url)
          ? <video controls className="w-full rounded-lg bg-black" src={c.content.url} onTimeUpdate={(e) => reportProgress(e.currentTarget)} onEnded={() => !done && complete.mutate()} />
          : <a href={c.content.url} target="_blank" rel="noopener noreferrer" className="inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Watch video ↗</a>
        : <Alert kind="info">The video for this lesson has not been added yet.</Alert>)}

      {c.contentType === 'AUDIO' && (c.content.fileUrl
        ? <audio controls className="w-full" src={c.content.fileUrl} onTimeUpdate={(e) => reportProgress(e.currentTarget)} onEnded={() => !done && complete.mutate()} />
        : <Alert kind="info">The audio for this lesson has not been added yet.</Alert>)}

      {(c.contentType === 'PDF' || c.contentType === 'DOWNLOAD') && (c.content.fileUrl ? (
        <div className="space-y-3">
          {c.contentType === 'PDF' && <iframe title={c.title} src={c.content.fileUrl} className="h-[70vh] w-full rounded-lg ring-1 ring-slate-200" />}
          <a href={c.content.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-indigo-700 underline">Open {c.content.fileName ?? 'file'} in a new tab</a>
        </div>
      ) : <Alert kind="info">The file for this lesson has not been added yet.</Alert>)}

      {c.contentType === 'EXTERNAL_LINK' && c.content.url && <a href={c.content.url} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline">Open resource ↗</a>}

      {c.assessment && <div className="mt-2"><AssessmentCard a={c.assessment} /></div>}
      {c.assignment && <div className="mt-2"><AssignmentPanel a={c.assignment} itemId={item.id} /></div>}
      {!canComplete && !c.assessment && !c.assignment && <div className="mt-2"><Alert kind="info">Your teacher has not attached the {label(c.contentType).toLowerCase()} to this item yet.</Alert></div>}

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        {canComplete && (done
          ? <span className="text-sm font-medium text-green-700">✓ Completed</span>
          : <Button onClick={() => complete.mutate()} busy={complete.isPending}>Mark as complete</Button>)}
        {next && (done || !canComplete) && <Button variant="secondary" onClick={() => onNext(next)}>Next: {next.title} →</Button>}
        {complete.isError && <span className="text-sm text-red-600">{errorMessage(complete.error)}</span>}
      </div>
    </Card>
  );
}

function LearnPage() {
  const { enrollmentId } = useParams<{ enrollmentId: string }>();
  const sp = useSearchParams();
  const moduleFilter = sp.get('module')?.toLowerCase() ?? null;
  const itemParam = sp.get('item');
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['course', enrollmentId], queryFn: () => api<Course>(`/me/courses/${enrollmentId}`) });
  const [activeId, setActiveId] = useState<string | null>(itemParam);

  const sections = useMemo(() => (data ? (moduleFilter ? data.sections.filter((x) => x.title.toLowerCase().startsWith(moduleFilter)) : data.sections) : []), [data, moduleFilter]);
  const items = useMemo(() => flatten(sections), [sections]);
  const active = items.find((i) => i.id === (activeId ?? items.find((x) => x.state !== 'COMPLETED' && x.state !== 'LOCKED')?.id ?? items[0]?.id)) ?? null;
  const next = active ? items.slice(items.indexOf(active) + 1).find((i) => i.state !== 'LOCKED') ?? null : null;

  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>{errorMessage(error)}</Alert>;

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <aside className="h-fit rounded-lg bg-white p-4 ring-1 ring-slate-200 lg:sticky lg:top-4">
        <h1 className="mb-3 font-semibold text-slate-900">{data.course.title}</h1>
        <div className="mb-4"><ProgressBar value={Number(data.enrollment.progressPercent)} label="Progress" /></div>
        <Tree sections={sections} activeId={active?.id ?? null} onSelect={(i) => setActiveId(i.id)} />
      </aside>
      <section aria-live="polite">
        {active ? <Viewer key={active.id} item={active} enrollmentId={enrollmentId} next={next} onNext={(i) => setActiveId(i.id)} /> : <Alert kind="info">This course has no content yet.</Alert>}
      </section>
    </div>
  );
}

export default function LearnRoute() {
  return <Suspense fallback={<Loading />}><LearnPage /></Suspense>;
}
