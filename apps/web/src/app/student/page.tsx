'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Card, Empty, LinkButton, Loading, PageHeader, ProgressBar } from '@/components/ui';
import { EnrollmentBadge, PaymentPendingNotice, primaryApplication, scheduleText, teacherText, useApplications } from '@/components/student';
import { IeltsSummary, IeltsSummaryLike } from '@/components/IeltsSummary';
import { api } from '@/lib/api';
import { band, date } from '@/lib/format';

interface Dashboard {
  profile: { firstName: string; currentBand: string | null; targetBand: string | null; ieltsExamDate: string | null; ielts?: IeltsSummaryLike };
  overallProgressPercent: number;
  courses: { enrollmentId: string; status: string; progressPercent: string; skills: Record<'listening' | 'reading' | 'writing' | 'speaking', number | null> }[];
}

const SKILLS = ['listening', 'reading', 'writing', 'speaking'] as const;

export default function DashboardPage() {
  const apps = useApplications();
  const { data, isLoading, isError } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/me/dashboard') });
  const app = primaryApplication(apps.data);
  const enrolled = !!app && ['ACTIVE', 'COMPLETED'].includes(app.status);
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ upcoming: { id: string; topic: string; startsAt: string; batch: string; joinUrl: string | null }[] }>('/me/sessions'), refetchInterval: 60_000, enabled: enrolled });
  const nextClass = sessions.data?.upcoming[0];

  if (isLoading || apps.isLoading) return <Loading />;
  if (isError || !data) return <Alert>Could not load your dashboard.</Alert>;
  const { profile } = data;
  const course = data.courses.find((c) => c.enrollmentId === app?.id);

  return (
    <>
      <PageHeader title={`Hello ${profile.firstName}`} subtitle="Here is where you are on your IELTS journey." actions={app && <EnrollmentBadge status={app.status} />} />

      {!enrolled && <div className="mb-6"><PaymentPendingNotice app={app} /></div>}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card><p className="text-sm text-slate-500">Target band</p><p className="mt-1 text-3xl font-semibold">{band(profile.targetBand)}</p></Card>
        <Card><p className="mb-1 text-sm text-slate-500">IELTS</p><IeltsSummary ielts={profile.ielts} /></Card>
        <Card><p className="text-sm text-slate-500">Planned exam date</p><p className="mt-1 text-xl font-semibold">{date(profile.ieltsExamDate)}</p></Card>
      </div>

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
        <Card>
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-slate-900">Course progress</h2><LinkButton href={`/student/learn/${course.enrollmentId}`}>Continue learning</LinkButton></div>
          <div className="space-y-2.5">
            <ProgressBar value={Number(course.progressPercent)} label="Overall" />
            {SKILLS.map((s) => course.skills[s] !== null && <ProgressBar key={s} value={course.skills[s]!} label={s[0].toUpperCase() + s.slice(1)} />)}
          </div>
        </Card>
      )}
    </>
  );
}
