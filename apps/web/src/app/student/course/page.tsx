'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Badge, Card, LinkButton, Loading, PageHeader, ProgressBar } from '@/components/ui';
import { EnrollmentBadge, PaymentPendingNotice, primaryApplication, scheduleText, useApplications } from '@/components/student';
import { IeltsSummaryLike } from '@/components/IeltsSummary';
import { api } from '@/lib/api';
import { band, date, label, money } from '@/lib/format';

interface Cert { id: string; code: string; courseTitle: string; issuedAt: string; valid: boolean }
interface PublicCourse { title: string; description: string | null; price: string; currency: string; durationWeeks: number | null; includes: string[]; modules: string[] }
interface Dashboard {
  profile: { targetBand: string | null; ieltsExamDate: string | null; academicOrGeneral: string | null; ielts?: IeltsSummaryLike };
  overallProgressPercent: number;
}
interface TreeItem { id: string; state: string; isRequired: boolean; module: string | null; mastered: boolean; needsReview: boolean }
interface TreeSection { id: string; module: string | null; items: TreeItem[]; children: TreeSection[] }
interface TodayItem { contentItemId?: string; title?: string; enrollmentId: string | null; source: string; module?: string | null; skillKey?: string }

const MODULES = ['LISTENING', 'READING', 'WRITING', 'SPEAKING'] as const;
const flatten = (s: TreeSection): TreeItem[] => [...s.items, ...s.children.flatMap(flatten)];

export default function MyCoursePage() {
  const apps = useApplications();
  const course = useQuery({ queryKey: ['public-course'], queryFn: () => api<PublicCourse>('/public/course') });
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/me/dashboard') });
  const certs = useQuery({ queryKey: ['certificates'], queryFn: () => api<Cert[]>('/me/certificates') });
  const app = primaryApplication(apps.data);
  const enrolled = !!app && ['ACTIVE', 'COMPLETED'].includes(app.status);
  const tree = useQuery({ queryKey: ['course', app?.id], enabled: enrolled, queryFn: () => api<{ sections: TreeSection[] }>(`/me/courses/${app!.id}`) });
  const today = useQuery({ queryKey: ['today'], enabled: enrolled, queryFn: () => api<{ requiredToday: TodayItem[]; recommended: TodayItem[]; optionalAssigned: TodayItem[] }>('/me/today') });

  if (apps.isLoading || course.isLoading) return <Loading />;
  if (apps.isError || !course.data) return <Alert>Could not load your course.</Alert>;
  const c = course.data;

  const allItems = tree.data?.sections.flatMap(flatten) ?? [];
  const moduleStats = (m: string) => {
    const items = allItems.filter((i) => i.module === m);
    const required = items.filter((i) => i.isRequired);
    return {
      total: items.length,
      notStarted: items.filter((i) => i.state === 'NOT_STARTED').length,
      inProgress: items.filter((i) => i.state === 'IN_PROGRESS').length,
      completed: items.filter((i) => i.state === 'COMPLETED').length,
      mastered: items.filter((i) => i.mastered).length,
      needsReview: items.filter((i) => i.needsReview).length,
      pct: required.length ? Math.round((required.filter((i) => i.state === 'COMPLETED').length / required.length) * 100) : 0,
    };
  };
  const personalised = [...(today.data?.requiredToday ?? []), ...(today.data?.recommended ?? []), ...(today.data?.optionalAssigned ?? [])].slice(0, 6);

  return (
    <>
      <PageHeader title="My Course" subtitle="Your personal IELTS learning journey." actions={app && <EnrollmentBadge status={app.status} />} />
      {!enrolled && <div className="mb-6"><PaymentPendingNotice app={app} /></div>}

      {enrolled && dash.data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-4">
          <Card><p className="text-sm text-slate-500">Track</p><p className="mt-1 text-lg font-semibold">{dash.data.profile.academicOrGeneral ? label(dash.data.profile.academicOrGeneral) : 'Not chosen'}</p></Card>
          <Card><p className="text-sm text-slate-500">Current estimate</p><p className="mt-1 text-lg font-semibold">{dash.data.profile.ielts?.status === 'TAKEN' ? `Band ${band(dash.data.profile.ielts.overall)}` : 'No official score yet'}</p></Card>
          <Card><p className="text-sm text-slate-500">Target band</p><p className="mt-1 text-lg font-semibold">{band(dash.data.profile.targetBand)}</p></Card>
          <Card><p className="text-sm text-slate-500">Exam date</p><p className="mt-1 text-lg font-semibold">{date(dash.data.profile.ieltsExamDate)}</p></Card>
        </div>
      )}

      {enrolled && app && (
        <Card className="mb-6">
          <ProgressBar value={dash.data?.overallProgressPercent ?? 0} label="Overall path progress" />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
            <span>{app.batch.name} · {scheduleText(app.batch)} · access until {date(app.accessEndsAt)}</span>
            <LinkButton href={`/student/learn/${app.id}`}>Open course content</LinkButton>
          </div>
        </Card>
      )}

      {enrolled && tree.data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((m) => {
            const s = moduleStats(m);
            return (
              <Link key={m} href={`/student/${m.toLowerCase()}`} className="block">
                <Card className="h-full transition hover:ring-2 hover:ring-indigo-200">
                  <p className="font-semibold capitalize text-slate-900">{m.toLowerCase()}</p>
                  <div className="mt-2"><ProgressBar value={s.pct} label="Required items" /></div>
                  <div className="mt-2 flex flex-wrap gap-1 text-xs">
                    {s.mastered > 0 && <Badge status="MASTERED" tone="green" text={`${s.mastered} mastered`} />}
                    {s.needsReview > 0 && <Badge status="NEEDS_REVIEW" tone="amber" text={`${s.needsReview} needs review`} />}
                    {s.inProgress > 0 && <Badge status="IN_PROGRESS" tone="blue" text={`${s.inProgress} in progress`} />}
                    {s.completed > 0 && <Badge status="COMPLETED" tone="slate" text={`${s.completed} completed`} />}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {enrolled && (
        <Card className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Personalised Path</h2>
            <span className="text-xs text-slate-500">Recommended based on your actual performance — not a fixed weekly schedule.</span>
          </div>
          {personalised.length === 0 ? <p className="text-sm text-slate-500">Nothing personalised yet — take a Diagnostic test or complete some practice to get recommendations.</p> : (
            <ul className="divide-y divide-slate-100">
              {personalised.map((i, idx) => (
                <li key={i.contentItemId ?? idx} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex items-center gap-2"><span>{i.title ?? 'Activity'}</span><Badge status={i.source} tone={i.source === 'TEACHER_ASSIGNED' ? 'blue' : 'slate'} /></span>
                  {i.enrollmentId && i.contentItemId && <Link href={`/student/learn/${i.enrollmentId}?item=${i.contentItemId}`} className="shrink-0 font-medium text-indigo-700 hover:underline">Start</Link>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Explore everything available (not just what is recommended) from each module's own page: <Link href="/student/listening" className="text-indigo-700 hover:underline">Listening</Link>, <Link href="/student/reading" className="text-indigo-700 hover:underline">Reading</Link>, <Link href="/student/writing" className="text-indigo-700 hover:underline">Writing</Link>, <Link href="/student/speaking" className="text-indigo-700 hover:underline">Speaking</Link>.
          </p>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">What is included</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{c.includes.map((i) => <li key={i}>{i}</li>)}</ul>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Modules</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{c.modules.map((m) => <li key={m}>{m}</li>)}</ul>
          <p className="mt-3 text-sm text-slate-500">{c.durationWeeks ? `${c.durationWeeks} weeks · ` : ''}{money(c.price, c.currency)}</p>
        </Card>
      </div>

      {certs.data && certs.data.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-semibold">Certificates</h2>
          <ul className="divide-y divide-slate-100 rounded-lg bg-white ring-1 ring-slate-200">
            {certs.data.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span><strong>{x.courseTitle}</strong> <span className="text-slate-500">· issued {date(x.issuedAt)} · {x.code}</span></span>
                {x.valid && <span className="flex gap-3"><a href={'/api/certificates/' + x.code + '/pdf'} className="font-medium text-indigo-700 underline">Download PDF</a><a href={'/verify/' + x.code} className="text-slate-600 underline">Verification page</a></span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
