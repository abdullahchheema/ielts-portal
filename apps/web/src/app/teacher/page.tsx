'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Card, Empty, LinkButton, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { date } from '@/lib/format';

interface Dash { batches: number; activeBatches: number; students: number; toGrade: number; upcomingSessions: { id: string; topic: string; startsAt: string; batch: { id: string; name: string } }[] }

export default function TeacherDashboard() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['teacher-dashboard'], queryFn: () => api<Dash>('/mentor/dashboard') });
  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>Could not load your dashboard.</Alert>;
  const stat = (n: number, l: string, href?: string) => (
    <Card><p className="text-sm text-slate-500">{l}</p><p className="mt-1 text-3xl font-semibold">{n}</p>{href && <Link href={href} className="mt-1 inline-block text-sm text-indigo-700 underline">Open</Link>}</Card>
  );

  return (
    <>
      <PageHeader title="Teacher dashboard" subtitle="Only the batches assigned to you appear here." />
      {data.batches === 0 && <div className="mb-6"><Alert kind="info">You have not been assigned to a batch yet. When the academy assigns you one, its students and classes show up here.</Alert></div>}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stat(data.batches, 'Assigned batches', '/teacher/batches')}
        {stat(data.activeBatches, 'Active batches')}
        {stat(data.students, 'Students')}
        {stat(data.toGrade, 'Submissions to grade', '/teacher/grading')}
      </div>
      <h2 className="mb-3 text-lg font-semibold">Upcoming classes</h2>
      {data.upcomingSessions.length === 0 ? <Empty>No upcoming classes. Schedule one from a batch page.<div className="mt-3"><LinkButton href="/teacher/batches" variant="secondary">My batches</LinkButton></div></Empty> : (
        <ul className="divide-y divide-slate-100 rounded-lg bg-white ring-1 ring-slate-200">
          {data.upcomingSessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span><strong>{s.topic}</strong> <span className="text-slate-500">· {date(s.startsAt, true)}</span></span>
              <Link href={`/teacher/batches/${s.batch.id}`} className="text-indigo-700 underline">{s.batch.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
