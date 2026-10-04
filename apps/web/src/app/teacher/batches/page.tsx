'use client';

import { SkeletonTable } from '@/components/ui';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { scheduleText } from '@/components/student';
import { Alert, Badge, Card, Empty, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { date, label } from '@/lib/format';

interface MyBatch { id: string; name: string; status: string; startAt: string; myRole: string; days: string[]; classTime: string | null; studentCount: number }

export default function TeacherBatches() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['mentor-batches'], queryFn: () => api<MyBatch[]>('/mentor/batches') });
  if (isLoading) return <SkeletonTable rows={6} cols={5} />;
  if (isError) return <Alert>Could not load your batches.</Alert>;
  return (
    <>
      <PageHeader title="My batches" subtitle="Open a batch for its students, live classes, attendance and results." />
      {!data?.length ? <Empty>You have not been assigned to a batch yet.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((b) => (
            <Link key={`${b.id}-${b.myRole}`} href={`/teacher/batches/${b.id}`}>
              <Card className="hover:ring-indigo-300">
                <div className="flex items-start justify-between gap-2"><h2 className="font-semibold">{b.name}</h2><Badge status={b.status} /></div>
                <p className="mt-1 text-sm text-fg-muted">{scheduleText(b)}</p>
                <p className="mt-2 text-xs text-fg-muted">{label(b.myRole)} teacher · starts {date(b.startAt)} · {b.studentCount} student{b.studentCount === 1 ? '' : 's'}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
