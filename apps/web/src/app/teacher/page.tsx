'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ClipboardCheck, Layers, Users } from 'lucide-react';
import Link from 'next/link';
import { Alert, Card, Empty, LinkButton, PageHeader, Section, SkeletonTable, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import { date } from '@/lib/format';

interface Dash { batches: number; activeBatches: number; students: number; toGrade: number; upcomingSessions: { id: string; topic: string; startsAt: string; batch: { id: string; name: string } }[] }

export default function TeacherDashboard() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['teacher-dashboard'], queryFn: () => api<Dash>('/mentor/dashboard') });
  if (isLoading) return <SkeletonTable rows={6} cols={5} />;
  if (isError || !data) return <Alert>Could not load your dashboard.</Alert>;

  return (
    <>
      <PageHeader title="Teacher dashboard" subtitle="Only the batches assigned to you appear here." />
      {data.batches === 0 && <div className="mb-8"><Alert kind="info">You have not been assigned to a batch yet. When the academy assigns you one, its students and classes show up here.</Alert></div>}

      <Section title="At a glance">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Assigned batches" value={data.batches} href="/teacher/batches" icon={Layers} />
          <StatCard label="Active batches" value={data.activeBatches} icon={Layers} />
          <StatCard label="Students" value={data.students} icon={Users} />
          <StatCard label="Submissions to grade" value={data.toGrade} href="/teacher/grading" icon={ClipboardCheck} attention={data.toGrade > 0} />
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
