'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { Alert, Badge, Card, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { band, date, money } from '@/lib/format';

interface Detail {
  id: string; firstName: string; lastName: string; currentBand: string | null; targetBand: string | null; ieltsExamDate: string | null; country: string | null;
  user: { email: string; phone: string | null; status: string; createdAt: string; lastLoginAt: string | null };
  enrollments: { id: string; status: string; progressPercent: string; course: { title: string }; batch: { name: string } }[];
  orders: { id: string; reference: string; status: string; total: string; currency: string; createdAt: string }[];
  timeline: { id: string; type: string; summary: string; createdAt: string }[];
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: s, isLoading, isError } = useQuery({ queryKey: ['admin-student', id], queryFn: () => api<Detail>(`/admin/students/${id}`) });
  if (isLoading) return <Loading />;
  if (isError || !s) return <Alert>Student not found.</Alert>;
  return (
    <>
      <PageHeader title={`${s.firstName} ${s.lastName}`} subtitle={`${s.user.email}${s.user.phone ? ` · ${s.user.phone}` : ''}`} actions={<Badge status={s.user.status} />} />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Card><p className="text-sm text-slate-500">Current</p><p className="text-2xl font-semibold">{band(s.currentBand)}</p></Card>
        <Card><p className="text-sm text-slate-500">Target</p><p className="text-2xl font-semibold">{band(s.targetBand)}</p></Card>
        <Card><p className="text-sm text-slate-500">Exam date</p><p className="text-lg font-semibold">{date(s.ieltsExamDate)}</p></Card>
        <Card><p className="text-sm text-slate-500">Last login</p><p className="text-lg font-semibold">{date(s.user.lastLoginAt, true)}</p></Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <div><h2 className="mb-2 font-semibold">Enrollments</h2>
            {s.enrollments.length === 0 ? <p className="text-sm text-slate-500">None.</p> : (
              <Table head={['Course', 'Batch', 'Progress', 'Status']}>{s.enrollments.map((e) => <tr key={e.id}><Td>{e.course.title}</Td><Td>{e.batch.name}</Td><Td>{Math.round(Number(e.progressPercent))}%</Td><Td><Badge status={e.status} /></Td></tr>)}</Table>)}
          </div>
          <div><h2 className="mb-2 font-semibold">Orders</h2>
            {s.orders.length === 0 ? <p className="text-sm text-slate-500">None.</p> : (
              <Table head={['Reference', 'Total', 'Status', 'Date']}>{s.orders.map((o) => <tr key={o.id}><Td className="font-mono text-xs">{o.reference}</Td><Td>{money(o.total, o.currency)}</Td><Td><Badge status={o.status} /></Td><Td>{date(o.createdAt)}</Td></tr>)}</Table>)}
          </div>
        </div>
        <Card>
          <h2 className="mb-3 font-semibold">Timeline</h2>
          <ol className="space-y-3 border-l-2 border-slate-100 pl-4 text-sm">
            {s.timeline.length === 0 && <li className="text-slate-500">No activity yet.</li>}
            {s.timeline.map((t) => <li key={t.id}><p className="text-xs text-slate-500">{date(t.createdAt, true)}</p><p>{t.summary}</p></li>)}
          </ol>
        </Card>
      </div>
    </>
  );
}
