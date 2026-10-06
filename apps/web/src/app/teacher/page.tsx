'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ClipboardCheck, Layers, Users } from 'lucide-react';
import Link from 'next/link';
import { Alert, Card, Empty, LinkButton, PageHeader, Section, SkeletonTable, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { TeacherWorkload } from '@/components/TeacherWorkload';

interface Dash { gradingTargetHours: number; grading: { waiting: number; oldestWaitingHours: number | null; overTarget: number; medianTurnaroundHours: number | null }; unmarkedSessions: number; batches: number; activeBatches: number; students: number; toGrade: number; upcomingSessions: { id: string; topic: string; startsAt: string; batch: { id: string; name: string } }[] }

export default function TeacherDashboard() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['teacher-dashboard'], queryFn: () => api<Dash>('/mentor/dashboard') });
  if (isLoading) return <SkeletonTable rows={6} cols={5} />;
  if (isError || !data) return <Alert>Could not load your dashboard.</Alert>;

  return (
    <>
      <PageHeader title="Teacher dashboard" subtitle="Only the batches assigned to you appear here." />
      {data.batches === 0 && <div className="mb-8"><Alert kind="info">You have not been assigned to a batch yet. When the academy assigns you one, its students and classes show up here.</Alert></div>}

      <TeacherWorkload />

      <Section title="At a glance">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Assigned batches" value={data.batches} href="/teacher/batches" icon={Layers} />
          <StatCard label="Active batches" value={data.activeBatches} icon={Layers} />
          <StatCard label="Students" value={data.students} icon={Users} />
          <StatCard label="Submissions to grade" value={data.toGrade} href="/teacher/grading" icon={ClipboardCheck} attention={data.toGrade > 0} />
        </div>
      </Section>

      <Section title="Grading and attendance" description={`Informational. Your target is ${data.gradingTargetHours} hours to grade.`}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Oldest waiting" value={data.grading.oldestWaitingHours === null ? 'None' : `${data.grading.oldestWaitingHours} h`} hint="Submitted and not yet graded" attention={(data.grading.oldestWaitingHours ?? 0) > data.gradingTargetHours} />
          <StatCard label="Past target" value={data.grading.overTarget} hint={`Waiting longer than ${data.gradingTargetHours} hours`} attention={data.grading.overTarget > 0} />
          <StatCard label="Median turnaround" value={data.grading.medianTurnaroundHours === null ? 'Not enough data' : `${data.grading.medianTurnaroundHours} h`} hint="Last 30 days" />
          <StatCard label="Sessions without attendance" value={data.unmarkedSessions} hint="Last 30 days. Unmarked sessions lower every student's percentage." attention={data.unmarkedSessions > 0} href="/teacher/batches" />
        </div>
      </Section>

      <Section title="Upcoming classes">
        {data.upcomingSessions.length === 0 ? (
          <Empty icon={CalendarClock} title="No upcoming classes" action={<LinkButton href="/teacher/batches" variant="secondary">Open my batches</LinkButton>}>
            Schedule a class from one of your batch pages.
          </Empty>
        ) : (
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {data.upcomingSessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-4 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-fg">{s.topic}</p>
                    <p className="text-fg-muted tabular-nums">{date(s.startsAt, true)}</p>
                  </div>
                  <Link href={`/teacher/batches/${s.batch.id}`} className="rounded-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">{s.batch.name}</Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>
    </>
  );
}
