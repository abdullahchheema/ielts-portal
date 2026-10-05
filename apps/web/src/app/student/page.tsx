'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarClock, GraduationCap, Target, Video } from 'lucide-react';
import Link from 'next/link';
import { Alert, Card, Empty, LinkButton, Loading, PageHeader, ProgressBar, ProgressRing, Section } from '@/components/ui';
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
  const overall = Number(course?.progressPercent ?? data.overallProgressPercent ?? 0);

  return (
    <>
      <PageHeader
        title={`Hello ${profile.firstName}`}
        subtitle="Here is what needs your attention, then where you stand on the course."
        actions={app && <EnrollmentBadge status={app.status} />}
      />

      {/* 1. What to do now */}
      <Section title="Up next">
        {!enrolled ? (
          <PaymentPendingNotice app={app} />
        ) : nextClass ? (
          <Card className="flex flex-wrap items-center justify-between gap-4 border-l-4 border-l-primary">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary"><CalendarClock aria-hidden className="size-5" strokeWidth={1.75} /></span>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Next class</p>
                <p className="mt-0.5 font-semibold text-fg">{nextClass.topic}</p>
                <p className="text-sm text-fg-muted tabular-nums">{date(nextClass.startsAt, true)} · {nextClass.batch}</p>
              </div>
            </div>
            {nextClass.joinUrl
              ? <a href={nextClass.joinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md bg-success px-4 py-2 text-sm font-medium text-white shadow-xs transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><Video aria-hidden className="size-4" />Join class</a>
              : <Link href="/student/schedule" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">See schedule <ArrowRight aria-hidden className="size-4" /></Link>}
          </Card>
        ) : course ? (
          <Card className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-fg">Continue your course</p>
              <p className="mt-0.5 text-sm text-fg-muted">Pick up the next lesson where you left off.</p>
            </div>
            <LinkButton href={`/student/learn/${course.enrollmentId}`}>Continue learning</LinkButton>
          </Card>
        ) : (
          <Card><p className="text-sm text-fg-muted">No class is scheduled yet. Your teacher will announce the timetable.</p></Card>
        )}
      </Section>

      {/* 2. Where you stand */}
      <Section title="Your IELTS goals">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <p className="flex items-center gap-2 text-sm font-medium text-fg-muted"><Target aria-hidden className="size-4" />Target band</p>
            <p className="mt-2 font-display text-3xl font-semibold tracking-tight tabular-nums text-fg">{band(profile.targetBand)}</p>
          </Card>
          <Card>
            <p className="mb-2 text-sm font-medium text-fg-muted">IELTS</p>
            <IeltsSummary ielts={profile.ielts} />
          </Card>
          <Card>
            <p className="flex items-center gap-2 text-sm font-medium text-fg-muted"><GraduationCap aria-hidden className="size-4" />Planned exam date</p>
            <p className="mt-2 font-display text-xl font-semibold text-fg">{date(profile.ieltsExamDate)}</p>
          </Card>
        </div>
      </Section>

      {/* 3. Course progress */}
      {app && (
        <Section title="Course progress">
          <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
            {enrolled && course && (
              <Card className="flex flex-col items-center justify-center gap-3 lg:w-56">
                <ProgressRing value={overall} size={96} label="Overall course progress" />
                <p className="text-sm font-medium text-fg">Overall</p>
              </Card>
            )}
            <Card className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-fg">{app.batch.name}</p>
                  <p className="text-sm text-fg-muted">Starts {date(app.batch.startAt)} · {scheduleText(app.batch)}</p>
                  <p className="text-sm text-fg-muted">Teacher: {teacherText(app.batch.mentors)}</p>
                </div>
                <Link href="/student/application" className="rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">Application &amp; payment</Link>
              </div>
              {enrolled && course ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {SKILLS.map((s) => course.skills[s] !== null && <ProgressBar key={s} value={course.skills[s]!} label={s[0].toUpperCase() + s.slice(1)} />)}
                </div>
              ) : !enrolled ? null : <Empty>Your course progress will appear here.</Empty>}
            </Card>
          </div>
        </Section>
      )}

      {!app && <Empty icon={GraduationCap} title="You have not enrolled yet" action={<LinkButton href="/register">Join the next batch</LinkButton>}>Choose a batch to start your IELTS preparation.</Empty>}
    </>
  );
}
