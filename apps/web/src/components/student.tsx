'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ReactNode, useState } from 'react';
import { Alert, Badge, Card, Empty, Input, LinkButton, Loading, PageHeader, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date, label } from '@/lib/format';

export interface Application {
  id: string; status: string; displayStatus: string; createdAt: string; enrolledAt: string | null; accessEndsAt: string | null;
  batch: { id: string; name: string; startAt: string; days: string[]; classTime: string | null; timezone: string; deliveryMode: string; mentors: { name: string; role: string }[] };
  order: { id: string; reference: string; total: string; currency: string; status: string } | null;
  payment: { proofId: string; method: string; reference: string; claimedAmount: string; status: string; rejectionReason: string | null; submittedAt: string; fileUrl?: string | null; fileMime?: string | null } | null;
  canResubmit: boolean;
}

export const STATUS_TEXT: Record<string, string> = {
  PENDING_PAYMENT: 'Pending payment verification', ACTIVE: 'Enrolled', REJECTED: 'Rejected',
  PAUSED: 'Paused', COMPLETED: 'Completed', EXPIRED: 'Access expired', CANCELLED: 'Cancelled',
};
export const METHOD_TEXT: Record<string, string> = { BANK_TRANSFER: 'Bank transfer', JAZZCASH: 'JazzCash', EASYPAISA: 'Easypaisa', OTHER: 'Other' };
export const DAY_TEXT: Record<string, string> = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };

export function EnrollmentBadge({ status }: { status: string }) {
  return <Badge status={status} text={STATUS_TEXT[status] ?? label(status)} />;
}

export const scheduleText = (b: { days: string[]; classTime: string | null }) =>
  b.days.length ? `${b.days.map((d) => DAY_TEXT[d] ?? d).join(', ')}${b.classTime ? ` · ${b.classTime}` : ''}` : 'Schedule to be announced';

export const teacherText = (mentors: { name: string; role: string }[]) => (mentors.length ? mentors.map((m) => m.name).join(', ') : 'Not assigned yet');

export function useApplications() {
  return useQuery({ queryKey: ['applications'], queryFn: () => api<Application[]>('/me/applications') });
}

/** The application that matters right now: the active enrollment if any, otherwise the newest one. */
export function primaryApplication(list: Application[] | undefined): Application | null {
  if (!list?.length) return null;
  return list.find((a) => ['ACTIVE', 'COMPLETED', 'PAUSED'].includes(a.status)) ?? list.find((a) => a.status === 'PENDING_PAYMENT') ?? list[0];
}

export function PaymentPendingNotice({ app }: { app: Application | null }) {
  if (!app) {
    return <Empty>You have not applied for a batch yet.<div className="mt-3"><LinkButton href="/register">Join the next batch</LinkButton></div></Empty>;
  }
  if (app.status === 'REJECTED') {
    return <Alert kind="error">Your application for <strong>{app.batch.name}</strong> was not approved{app.payment?.rejectionReason ? `: ${app.payment.rejectionReason}` : '.'} <Link href="/register" className="font-medium underline">Apply for another batch</Link></Alert>;
  }
  return (
    <Alert kind="warning">
      {app.canResubmit
        ? <>Your payment proof was not accepted{app.payment?.rejectionReason ? ` (${app.payment.rejectionReason})` : ''}. <Link href="/student/application" className="font-medium underline">Upload a corrected proof</Link></>
        : <>Your payment is being verified. Course content unlocks as soon as the academy confirms it — usually within one working day. <Link href="/student/application" className="font-medium underline">View my application</Link></>}
    </Alert>
  );
}

interface TreeItem { id: string; title: string; contentType: string; state: string; isRequired: boolean; estimatedMinutes: number | null }
interface TreeSection { id: string; title: string; items: TreeItem[]; children: TreeSection[] }

const flat = (s: TreeSection): TreeItem[] => [...s.items, ...s.children.flatMap(flat)];
const ICON: Record<string, string> = { COMPLETED: '✓', LOCKED: '🔒', IN_PROGRESS: '◐', NOT_STARTED: '○' };

/** One course module (Listening, Reading …): its lessons and tests, straight from the course tree. */
export function ModulePage({ match, title, blurb, extra }: { match: string; title: string; blurb: string; extra?: ReactNode }) {
  const apps = useApplications();
  const app = primaryApplication(apps.data);
  const enrolled = !!app && ['ACTIVE', 'COMPLETED'].includes(app.status);
  const course = useQuery({
    queryKey: ['course', app?.id], enabled: enrolled,
    queryFn: () => api<{ sections: TreeSection[] }>(`/me/courses/${app!.id}`),
  });
  if (apps.isLoading) return <Loading />;

  const sections = (course.data?.sections ?? []).filter((s) => s.title.toLowerCase().startsWith(match));
  return (
    <>
      <PageHeader title={title} subtitle={blurb} />
      {!enrolled ? <PaymentPendingNotice app={app} /> : course.isLoading ? <Loading /> : course.isError ? <Alert>{errorMessage(course.error)}</Alert> : sections.length === 0 ? (
        <Empty>Your teacher has not added {title.toLowerCase()} material yet.</Empty>
      ) : (
        sections.map((s) => (
          <Card key={s.id} className="mb-4">
            <h2 className="mb-3 font-semibold text-slate-900">{s.title}</h2>
            <ul className="divide-y divide-slate-100">
              {flat(s).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="flex items-center gap-2"><span aria-hidden className={i.state === 'COMPLETED' ? 'text-green-600' : 'text-slate-400'}>{ICON[i.state] ?? '○'}</span>{i.title}<span className="text-xs text-slate-400">{label(i.contentType)}{i.estimatedMinutes ? ` · ${i.estimatedMinutes} min` : ''}</span></span>
                  {i.state === 'LOCKED'
                    ? <span className="text-xs text-slate-400">Locked</span>
                    : <Link href={`/student/learn/${app!.id}?item=${i.id}`} className="font-medium text-indigo-700 hover:underline">{i.state === 'COMPLETED' ? 'Review' : i.state === 'IN_PROGRESS' ? 'Continue' : 'Start'}</Link>}
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
      {extra}
    </>
  );
}

// ───────── IELTS module page template (spec §10): Overview, Learn, Practice over one module's real taxonomy-tagged tree ─────────
interface ModuleTreeItem {
  id: string; title: string; contentType: string; state: string; isRequired: boolean; estimatedMinutes: number | null;
  module: string | null; track: string; skillKey: string | null; activityKind: string; difficulty: string | null; isTimed: boolean;
  mastered: boolean; needsReview: boolean;
}
interface ModuleTreeSection { id: string; title: string; module: string | null; kind: string; items: ModuleTreeItem[]; children: ModuleTreeSection[] }
type Skills = Record<'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING', { latest: number | null; best: number | null; series: { at: string | null; band: number; title: string }[] }>;
interface TodayRec { contentItemId?: string; title?: string; skillKey?: string; reason?: string; enrollmentId: string | null }

const PRACTICE_KINDS = new Set(['PRACTICE', 'TIMED_PRACTICE', 'GUIDED_EXERCISE']);
const activityLabel = (k: string) => ({ LESSON: 'Lesson', WORKED_EXAMPLE: 'Worked example', GUIDED_EXERCISE: 'Guided exercise', PRACTICE: 'Practice', TIMED_PRACTICE: 'Timed practice', MASTERY_CHECK: 'Mastery check', PROMPT: 'Task', REVISION: 'Revision' }[k] ?? label(k));

function moduleFlatten(s: ModuleTreeSection): ModuleTreeItem[] { return [...s.items, ...s.children.flatMap(moduleFlatten)]; }

function ModuleItemRow({ i, enrollmentId }: { i: ModuleTreeItem; enrollmentId: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className={i.state === 'COMPLETED' ? 'text-green-600' : 'text-slate-400'}>{{ COMPLETED: '✓', LOCKED: '🔒', IN_PROGRESS: '◐', NOT_STARTED: '○' }[i.state] ?? '○'}</span>
        <span className="truncate">{i.title}</span>
        {i.mastered && <Badge status="MASTERED" tone="green" />}
        {i.needsReview && <Badge status="NEEDS_REVIEW" tone="amber" text="Needs review" />}
        <span className="shrink-0 text-xs text-slate-400">{activityLabel(i.activityKind)}{i.difficulty ? ` · ${label(i.difficulty)}` : ''}{i.isTimed ? ' · Timed' : ''}{i.estimatedMinutes ? ` · ${i.estimatedMinutes} min` : ''}</span>
      </span>
      {i.state === 'LOCKED' ? <span className="shrink-0 text-xs text-slate-400">Locked</span> : (
        <Link href={`/student/learn/${enrollmentId}?item=${i.id}`} className="shrink-0 font-medium text-indigo-700 hover:underline">{i.state === 'COMPLETED' ? 'Review' : i.state === 'IN_PROGRESS' ? 'Continue' : 'Start'}</Link>
      )}
    </li>
  );
}

function ModuleTree({ sections, search, enrollmentId }: { sections: ModuleTreeSection[]; search: string; enrollmentId: string }) {
  const q = search.trim().toLowerCase();
  const matches = (s: ModuleTreeSection): boolean => !q || s.title.toLowerCase().includes(q) || s.items.some((i) => i.title.toLowerCase().includes(q)) || s.children.some(matches);
  const visible = sections.filter(matches);
  if (!visible.length) return <p className="py-4 text-sm text-slate-500">No sections match &ldquo;{search}&rdquo;.</p>;
  return (
    <ul className="space-y-1">
      {visible.map((s) => (
        <li key={s.id}>
          <details open={!!q || s.kind !== 'UNIT'} className="rounded-md border border-slate-100">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-slate-900">{s.title}</summary>
            <div className="px-3 pb-2">
              {s.items.filter((i) => !q || i.title.toLowerCase().includes(q)).map((i) => <ul key={i.id} className="divide-y divide-slate-50"><ModuleItemRow i={i} enrollmentId={enrollmentId} /></ul>)}
              {s.children.length > 0 && <div className="ml-3 border-l border-slate-100 pl-3"><ModuleTree sections={s.children} search={search} enrollmentId={enrollmentId} /></div>}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

export function IeltsModulePage({ moduleKey, title, blurb }: { moduleKey: 'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING'; title: string; blurb: string }) {
  const apps = useApplications();
  const app = primaryApplication(apps.data);
  const enrolled = !!app && ['ACTIVE', 'COMPLETED'].includes(app.status);
  const course = useQuery({ queryKey: ['course', app?.id], enabled: enrolled, queryFn: () => api<{ sections: ModuleTreeSection[] }>(`/me/courses/${app!.id}`) });
  const skills = useQuery({ queryKey: ['skills'], enabled: enrolled, queryFn: () => api<Skills>('/me/skills') });
  const profile = useQuery({ queryKey: ['profile'], enabled: enrolled, queryFn: () => api<{ targetBand: string | null }>('/me/profile') });
  const today = useQuery({ queryKey: ['today'], enabled: enrolled, queryFn: () => api<{ recommended: TodayRec[] }>('/me/today') });

  const [tab, setTab] = useState<'overview' | 'learn' | 'practice'>('overview');
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState('ALL');
  const [timedOnly, setTimedOnly] = useState(false);

  if (apps.isLoading) return <Loading />;
  if (!enrolled) return <><PageHeader title={title} subtitle={blurb} /><PaymentPendingNotice app={app} /></>;
  if (course.isLoading) return <Loading />;
  if (course.isError || !course.data) return <Alert>{errorMessage(course.error)}</Alert>;

  const roots = course.data.sections.filter((s) => s.module === moduleKey);
  const allItems = roots.flatMap(moduleFlatten);
  const requiredItems = allItems.filter((i) => i.isRequired);
  const completedRequired = requiredItems.filter((i) => i.state === 'COMPLETED').length;
  const progressPct = requiredItems.length ? Math.round((completedRequired / requiredItems.length) * 100) : 0;
  const recentlyCompleted = allItems.filter((i) => i.state === 'COMPLETED').slice(-5).reverse();
  const skillPrefix = moduleKey.toLowerCase();
  const nextRecommended = today.data?.recommended.find((r) => r.skillKey?.startsWith(skillPrefix));
  const practiceItems = allItems
    .filter((i) => PRACTICE_KINDS.has(i.activityKind))
    .filter((i) => (difficulty === 'ALL' || i.difficulty === difficulty) && (!timedOnly || i.isTimed));

  const band = skills.data?.[moduleKey];
  const target = profile.data?.targetBand ? Number(profile.data.targetBand) : null;

  return (
    <>
      <PageHeader title={title} subtitle={blurb} />
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {(['overview', 'learn', 'practice'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize ${tab === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{t}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <h2 className="mb-2 font-semibold text-slate-900">Band</h2>
            {band?.latest != null ? (
              <p className="text-sm text-slate-700">Latest estimate: <strong>{band.latest}</strong>{target && <> · Target: <strong>{target}</strong></>}</p>
            ) : <p className="text-sm text-slate-500">No scored attempts yet — this will show once you complete a graded {title.toLowerCase()} test or submission. Automated practice estimates are never the same as an official IELTS score.</p>}
            <p className="mt-2 text-xs text-slate-400">Module progress: {progressPct}% of required items ({completedRequired}/{requiredItems.length})</p>
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold text-slate-900">Continue learning</h2>
            {nextRecommended ? (
              <p className="text-sm text-slate-700">{nextRecommended.title} <Link href={`/student/learn/${app!.id}?item=${nextRecommended.contentItemId}`} className="ml-2 font-medium text-indigo-700 hover:underline">Start</Link></p>
            ) : <p className="text-sm text-slate-500">No personalised recommendation yet — browse the Learn tab, or take a Diagnostic test so we can tailor one.</p>}
          </Card>
          <Card className="md:col-span-2">
            <h2 className="mb-2 font-semibold text-slate-900">Recently completed</h2>
            {recentlyCompleted.length ? <ul className="text-sm text-slate-700">{recentlyCompleted.map((i) => <li key={i.id}>{i.title}</li>)}</ul> : <p className="text-sm text-slate-500">Nothing completed yet.</p>}
          </Card>
        </div>
      )}

      {tab === 'learn' && (
        <>
          <div className="mb-3"><Input placeholder="Search lessons and units…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          {roots.length === 0 ? <Empty>Your teacher has not added {title.toLowerCase()} material yet.</Empty> : <ModuleTree sections={roots} search={search} enrollmentId={app!.id} />}
        </>
      )}

      {tab === 'practice' && (
        <>
          <div className="mb-3 flex flex-wrap gap-3">
            <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="w-auto">
              <option value="ALL">Any difficulty</option>
              {['FOUNDATION', 'EASY', 'MEDIUM', 'HARD'].map((d) => <option key={d} value={d}>{label(d)}</option>)}
            </Select>
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={timedOnly} onChange={(e) => setTimedOnly(e.target.checked)} /> Timed only</label>
          </div>
          {practiceItems.length === 0 ? <Empty>No practice items match these filters yet.</Empty> : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white px-4">{practiceItems.map((i) => <ModuleItemRow key={i.id} i={i} enrollmentId={app!.id} />)}</ul>
          )}
        </>
      )}
    </>
  );
}
