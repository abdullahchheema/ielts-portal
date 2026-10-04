'use client';

import { useConfirm } from '@/components/ui';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { can, useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { date, label } from '@/lib/format';

interface Batch {
  id: string; name: string; status: string; startAt: string; endAt: string | null; timezone: string; days: string[]; classTime: string | null; description: string | null;
  counts: { pending: number; enrolled: number }; course: { title: string }; version: { versionNumber: number };
  mentors: { mentorRole: 'MAIN' | 'WRITING' | 'SPEAKING'; mentor: { id: string; displayName: string } }[];
}
interface Mentor { id: string; displayName: string; status: string }
interface Student { enrollmentId: string; status: string; progressPercent: string; student: { firstName: string; lastName: string; currentBand: string | null; targetBand: string | null } }

// Mirrors the API's transition table so the UI only offers legal moves (the API still enforces it).
const NEXT: Record<string, string[]> = {
  DRAFT: ['OPEN', 'CANCELLED'], OPEN: ['DRAFT', 'IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'], COMPLETED: ['ARCHIVED'], CANCELLED: ['ARCHIVED'], ARCHIVED: [],
};

export default function BatchDetailPage() {
  const confirm = useConfirm();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [error, setError] = useState<string | null>(null);
  const [mentorId, setMentorId] = useState('');
  const [role, setRole] = useState('MAIN');

  const batch = useQuery({ queryKey: ['admin-batch', id], queryFn: () => api<Batch>(`/admin/batches/${id}`) });
  const mentors = useQuery({ queryKey: ['admin-mentors'], queryFn: () => api<Mentor[]>('/admin/mentors'), enabled: can(me, 'mentor.assign') });
  const students = useQuery({ queryKey: ['batch-students', id], queryFn: () => api<Student[]>(`/mentor/batches/${id}/students`), enabled: can(me, 'teaching.view') });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-batch', id] }); qc.invalidateQueries({ queryKey: ['admin-batches'] }); qc.invalidateQueries({ queryKey: ['batch-students', id] }); };
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); refresh(); } catch (e) { setError(errorMessage(e)); } };

  if (batch.isLoading) return <Loading />;
  if (batch.isError || !batch.data) return <Alert>Batch not found.</Alert>;
  const b = batch.data;
  const canEdit = can(me, 'batch.edit');

  return (
    <>
      <PageHeader title={b.name} subtitle={`${b.course.title} · starts ${date(b.startAt, true)} · ${b.days.length ? b.days.join(', ') : 'days not set'}${b.classTime ? ` at ${b.classTime}` : ''} · ${b.timezone}`} actions={<>
        <Badge status={b.status} />
        {canEdit && b.status !== 'ARCHIVED' && <Button variant="danger" onClick={() => confirm({ message: 'Remove this batch? Batches with past students are archived instead of deleted.', tone: 'danger', confirmLabel: 'Remove batch' }).then((ok) => { if (ok) { run(async () => { await api(`/admin/batches/${id}`, { method: 'DELETE' }); location.href = '/admin/batches'; }); } })}>Remove</Button>}
      </>} />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Students & status</h2>
          <p className="mb-3 text-sm text-fg-muted"><strong>{b.counts.enrolled}</strong> enrolled · <strong>{b.counts.pending}</strong> waiting for payment verification. Batches have no size limit.</p>
          {canEdit && (
            <div className="space-y-4">
              <div>
                <p className="mb-1 text-sm font-medium text-fg">Move to</p>
                <div className="flex flex-wrap gap-2">
                  {NEXT[b.status].length === 0 && <span className="text-sm text-fg-muted">No further transitions.</span>}
                  {NEXT[b.status].map((s) => (
                    <Button key={s} variant={s === 'CANCELLED' ? 'danger' : 'secondary'} onClick={() => (s === 'CANCELLED' ? confirm({ message: 'Cancel this batch?', tone: 'danger', confirmLabel: 'Cancel batch' }) : Promise.resolve(true)).then((ok) => { if (ok) { run(() => api(`/admin/batches/${id}`, { method: 'PATCH', body: { status: s } })); } })}>{label(s)}</Button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Teachers</h2>
          <ul className="mb-4 divide-y divide-border text-sm">
            {b.mentors.length === 0 && <li className="py-2 text-fg-muted">No teacher assigned yet. Students can still apply; once you assign one, they see this batch in their portal.</li>}
            {b.mentors.map((m) => (
              <li key={`${m.mentor.id}-${m.mentorRole}`} className="flex items-center justify-between py-2">
                <span>{m.mentor.displayName} <span className="text-fg-muted">· {label(m.mentorRole)}</span></span>
                {can(me, 'mentor.assign') && <Button variant="ghost" tone="danger" className="!py-1" onClick={() => run(() => api(`/admin/batches/${id}/mentors/${m.mentor.id}/${m.mentorRole}`, { method: 'DELETE' }))}>Remove</Button>}
              </li>
            ))}
          </ul>
          {can(me, 'mentor.assign') && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Teacher">{(p) => <Select {...p} value={mentorId} onChange={(e) => setMentorId(e.target.value)}><option value="">Select…</option>{mentors.data?.filter((m) => m.status === 'ACTIVE').map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</Select>}</Field>
              <Field label="Role">{(p) => <Select {...p} value={role} onChange={(e) => setRole(e.target.value)}><option value="MAIN">Main</option><option value="WRITING">Writing</option><option value="SPEAKING">Speaking</option></Select>}</Field>
              <Button disabled={!mentorId} onClick={() => run(() => api(`/admin/batches/${id}/mentors`, { method: 'POST', body: { mentorId, mentorRole: role } }))}>Assign</Button>
            </div>
          )}
        </Card>
      </div>

      {students.data && (
        <div className="mt-6">
          <h2 className="mb-3 font-semibold">Enrolled students ({students.data.length})</h2>
          {students.data.length === 0 ? <Alert kind="info">No enrolled students yet.</Alert> : (
            <Table head={['Student', 'Current → target', 'Progress', 'Status']}>
              {students.data.map((s) => (
                <tr key={s.enrollmentId}>
                  <Td>{s.student.firstName} {s.student.lastName}</Td>
                  <Td>{s.student.currentBand ?? '—'} → {s.student.targetBand ?? '—'}</Td>
                  <Td>{Math.round(Number(s.progressPercent))}%</Td>
                  <Td><Badge status={s.status} /></Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}
    </>
  );
}
