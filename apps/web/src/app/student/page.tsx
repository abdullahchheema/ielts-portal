'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Badge, Card, Empty, LinkButton, Loading, PageHeader, ProgressBar } from '@/components/ui';
import { EnrollmentBadge, PaymentPendingNotice, primaryApplication, scheduleText, teacherText, useApplications } from '@/components/student';
import { IeltsSummary, IeltsSummaryLike } from '@/components/IeltsSummary';
import { api } from '@/lib/api';
import { band, date, label } from '@/lib/format';

interface Dashboard {
  profile: { firstName: string; currentBand: string | null; targetBand: string | null; ieltsExamDate: string | null; academicOrGeneral: string | null; ielts?: IeltsSummaryLike };
  overallProgressPercent: number;
  courses: { enrollmentId: string; status: string; progressPercent: string; skills: Record<'listening' | 'reading' | 'writing' | 'speaking', number | null> }[];
}
type Skills = Record<'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING', { latest: number | null; best: number | null }>;
interface TodayItem { contentItemId?: string; assignmentId?: string; title?: string; enrollmentId: string | null; source: string }
interface Today { requiredToday: TodayItem[]; recommended: TodayItem[] }

const MODULES = ['listening', 'reading', 'writing', 'speaking'] as const;
const MODULE_KEY = { listening: 'LISTENING', reading: 'READING', writing: 'WRITING', speaking: 'SPEAKING' } as const;

export default function DashboardPage() {
  const apps = useApplications();
  const { data, isLoading, isError } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/me/dashboard') });
  const app = primaryApplication(apps.data);
  const enrolled = !!app && ['ACTIVE', 'COMPLETED'].includes(app.status);
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ upcoming: { id: string; topic: string; startsAt: string; batch: string; joinUrl: string | null }[] }>('/me/sessions'), refetchInterval: 60_000, enabled: enrolled });
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => api<Skills>('/me/skills'), enabled: enrolled });
  const today = useQuery({ queryKey: ['today'], queryFn: () => api<Today>('/me/today'), enabled: enrolled });
  const nextClass = sessions.data?.upcoming[0];

  if (isLoading || apps.isLoading) return <Loading />;
  if (isError || !data) return <Alert>Could not load your dashboard.</Alert>;
  const { profile } = data;
  const course = data.courses.find((c) => c.enrollmentId === app?.id);
  const nextActivity = today.data?.requiredToday[0] ?? today.data?.recommended[0];

  return (
    <>
      <PageHeader title={`Hello ${profile.firstName}`} subtitle="Here is where you are on your IELTS journey." actions={app && <EnrollmentBadge status={app.status} />} />

      {!enrolled && <div className="mb-6"><PaymentPendingNotice app={app} /></div>}

      {enrolled && !profile.academicOrGeneral && (
        <Alert kind="info">
          Choose your IELTS track so we can show you the right Reading and Writing content. <Link href="/student/profile" className="font-medium underline">Choose Academic or General Training</Link>
        </Alert>
      )}

      <div className="mb-6 mt-4 grid gap-4 sm:grid-cols-3">
        <Card><p className="text-sm text-slate-500">Track</p><p className="mt-1 text-xl font-semibold">{profile.academicOrGeneral ? label(profile.academicOrGeneral) : 'Not chosen'}</p></Card>
        <Card><p className="text-sm text-slate-500">Target band</p><p className="mt-1 text-3xl font-semibold">{band(profile.targetBand)}</p></Card>
        <Card><p className="text-sm text-slate-500">Planned exam date</p><p className="mt-1 text-xl font-semibold">{date(profile.ieltsExamDate)}</p></Card>
      </div>

      <Card className="mb-6"><p className="mb-1 text-sm text-slate-500">Official IELTS history</p><IeltsSummary ielts={profile.ielts} /></Card>

      {enrolled && skills.data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((m) => {
            const s = skills.data![MODULE_KEY[m]];
            const pct = course?.skills[m] ?? null;
            return (
              <Card key={m}>
                <p className="text-sm font-semibold capitalize text-slate-900">{m}</p>
                {s.latest != null ? <p className="mt-1 text-2xl font-semibold">{s.latest}<span className="ml-1 text-xs font-normal text-slate-400">latest estimate</span></p> : <p className="mt-1 text-sm text-slate-500">No scored attempts yet</p>}
                {pct !== null && <div className="mt-2"><ProgressBar value={pct} label="Progress" /></div>}
                <Link href={`/student/${m}`} className="mt-2 inline-block text-xs font-medium text-indigo-700 hover:underline">Open {m}</Link>
              </Card>
            );
          })}
        </div>
      )}

      {app && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm text-slate-500">My batch</p>
              <p className="font-semibold text-slate-900">{app.batch.name}</p>
              <p className="text-sm text-slate-600">Starts {date(app.batch.startAt)} · {scheduleText(app.batch)}</p>
              <p className="text-sm text-slate-600">Teacher: {teacherText(app.batch.mentors)}</p>
            </div>
            <Link href="/student/application" className="text-sm font-medium text-indigo-700 underline">Application & payment</Link>
          </div>
        </Card>
      )}

      {nextClass && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm text-slate-500">Next class</p><p className="font-semibold text-slate-900">{nextClass.topic}</p><p className="text-sm text-slate-600">{date(nextClass.startsAt, true)} · {nextClass.batch}</p></div>
          {nextClass.joinUrl
            ? <a href={nextClass.joinUrl} target="_blank" rel="noopener noreferrer" className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">Join now ↗</a>
            : <Link href="/student/schedule" className="text-sm text-indigo-700 underline">See schedule</Link>}
        </Card>
      )}

      {!app && <Empty>You have not enrolled yet.<div className="mt-3"><LinkButton href="/register">Join the next batch</LinkButton></div></Empty>}

      {enrolled && course && (
        <Card className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Continue learning</h2>
            <LinkButton href="/student/today">Today's workspace</LinkButton>
          </div>
          {nextActivity ? (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span><strong>{nextActivity.title ?? 'Next activity'}</strong> <Badge status={nextActivity.source} tone={nextActivity.source === 'TEACHER_ASSIGNED' ? 'blue' : 'slate'} /></span>
              {nextActivity.enrollmentId && nextActivity.contentItemId && <Link href={`/student/learn/${nextActivity.enrollmentId}?item=${nextActivity.contentItemId}`} className="font-medium text-indigo-700 hover:underline">Start</Link>}
            </div>
          ) : <p className="text-sm text-slate-500">Nothing urgent right now — browse <Link href="/student/course" className="text-indigo-700 hover:underline">My Course</Link> to keep going.</p>}
          <div className="mt-3"><ProgressBar value={Number(course.progressPercent)} label="Overall course progress" /></div>
        </Card>
      )}
    </>
  );
}
