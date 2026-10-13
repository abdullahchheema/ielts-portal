'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, PageHeader, ProgressBar, Select, Table, Td } from '@/components/ui';
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
interface Analytics {
  totalEnrolled: number; activeStudents: number; lowAttendanceStudents: number; studentsWithOutstandingWork: number;
  classes: { scheduled: number; inProgress: number; completed: number; cancelled: number };
  averageAttendancePercent: number | null; attendanceSampleSize: number;
  recordings: { published: number; pending: number };
}
interface SessionRow { id: string; topic: string; startsAt: string; endsAt: string; status: string; meetingUrl: string | null; recordingUrl: string | null; _count: { attendance: number } }
interface RecordingRow { id: string; title: string; status: string; driveUrl: string; submittedAt: string; publishedAt: string | null; reviewNote: string | null; session: { topic: string } | null }

// Mirrors the API's transition table so the UI only offers legal moves (the API still enforces it).
const NEXT: Record<string, string[]> = {
  DRAFT: ['OPEN', 'CANCELLED'], OPEN: ['DRAFT', 'IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'], COMPLETED: ['ARCHIVED'], CANCELLED: ['ARCHIVED'], ARCHIVED: [],
};

function Stat({ label: l, value, hint }: { label: string; value: string | number; hint?: string }) {
  return <Card><p className="text-sm text-slate-500">{l}</p><p className="mt-1 text-2xl font-semibold">{value}</p>{hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}</Card>;
}

function Overview({ id, b, canEdit, run }: { id: string; b: Batch; canEdit: boolean; run: (fn: () => Promise<unknown>) => void }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [mentorId, setMentorId] = useState('');
  const [role, setRole] = useState('MAIN');
  const mentors = useQuery({ queryKey: ['admin-mentors'], queryFn: () => api<Mentor[]>('/admin/mentors'), enabled: can(me, 'mentor.assign') });
  const analytics = useQuery({ queryKey: ['batch-analytics', id], queryFn: () => api<Analytics>(`/admin/batches/${id}/analytics`), enabled: can(me, 'batch.analytics.view') });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-batch', id] }); qc.invalidateQueries({ queryKey: ['batch-analytics', id] }); qc.invalidateQueries({ queryKey: ['admin-batches'] }); };

  return (
    <>
      {analytics.isLoading && <Loading />}
      {analytics.data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Enrolled students" value={analytics.data.totalEnrolled} hint={`${analytics.data.activeStudents} active in the last 14 days`} />
          <Stat label="Average attendance" value={analytics.data.averageAttendancePercent === null ? '—' : `${analytics.data.averageAttendancePercent}%`} hint={`${analytics.data.attendanceSampleSize} recorded entries over completed classes`} />
          <Stat label="Classes" value={`${analytics.data.classes.completed} completed`} hint={`${analytics.data.classes.scheduled} scheduled · ${analytics.data.classes.cancelled} cancelled`} />
          <Stat label="Needs attention" value={analytics.data.lowAttendanceStudents + analytics.data.studentsWithOutstandingWork} hint={`${analytics.data.lowAttendanceStudents} low attendance · ${analytics.data.studentsWithOutstandingWork} overdue work`} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Students & status</h2>
          <p className="mb-3 text-sm text-slate-600"><strong>{b.counts.enrolled}</strong> enrolled · <strong>{b.counts.pending}</strong> waiting for payment verification. Batches have no size limit.</p>
          {canEdit && (
            <div>
              <p className="mb-1 text-sm font-medium text-slate-700">Move to</p>
              <div className="flex flex-wrap gap-2">
                {NEXT[b.status].length === 0 && <span className="text-sm text-slate-500">No further transitions.</span>}
                {NEXT[b.status].map((s) => (
                  <Button key={s} variant={s === 'CANCELLED' ? 'danger' : 'secondary'} onClick={() => (s !== 'CANCELLED' || confirm('Cancel this batch?')) && run(async () => { await api(`/admin/batches/${id}`, { method: 'PATCH', body: { status: s } }); refresh(); })}>{label(s)}</Button>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Teachers</h2>
          <ul className="mb-4 divide-y divide-slate-100 text-sm">
            {b.mentors.length === 0 && <li className="py-2 text-slate-500">No teacher assigned yet. Students can still apply; once you assign one, they see this batch in their portal.</li>}
            {b.mentors.map((m) => (
              <li key={`${m.mentor.id}-${m.mentorRole}`} className="flex items-center justify-between py-2">
                <span>{m.mentor.displayName} <span className="text-slate-500">· {label(m.mentorRole)}</span></span>
                {can(me, 'mentor.assign') && <Button variant="ghost" className="!py-1 text-red-600" onClick={() => run(async () => { await api(`/admin/batches/${id}/mentors/${m.mentor.id}/${m.mentorRole}`, { method: 'DELETE' }); refresh(); })}>Remove</Button>}
              </li>
            ))}
          </ul>
          {can(me, 'mentor.assign') && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Teacher">{(p) => <Select {...p} value={mentorId} onChange={(e) => setMentorId(e.target.value)}><option value="">Select…</option>{mentors.data?.filter((m) => m.status === 'ACTIVE').map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</Select>}</Field>
              <Field label="Role">{(p) => <Select {...p} value={role} onChange={(e) => setRole(e.target.value)}><option value="MAIN">Main</option><option value="WRITING">Writing</option><option value="SPEAKING">Speaking</option></Select>}</Field>
              <Button disabled={!mentorId} onClick={() => run(async () => { await api(`/admin/batches/${id}/mentors`, { method: 'POST', body: { mentorId, mentorRole: role } }); refresh(); })}>Assign</Button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function ClassesAndSchedule({ id }: { id: string }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['batch-sessions', id], queryFn: () => api<SessionRow[]>(`/mentor/batches/${id}/sessions`) });
  if (isLoading) return <Loading />;
  if (isError) return <Alert>Could not load this batch's classes. This view needs teaching.view permission.</Alert>;
  if (!data?.length) return <Empty>No classes scheduled yet.</Empty>;
  const now = Date.now();
  return (
    <Table head={['Class', 'When', 'Status', 'Zoom link', 'Attendance', 'Recording']}>
      {data.map((s) => {
        const joinable = s.meetingUrl && now >= new Date(s.startsAt).getTime() - 15 * 60_000 && now <= new Date(s.endsAt).getTime();
        return (
          <tr key={s.id}>
            <Td className="font-medium">{s.topic}</Td>
            <Td>{date(s.startsAt, true)}</Td>
            <Td><Badge status={s.status} tone={s.status === 'COMPLETED' ? 'green' : s.status === 'CANCELLED' ? 'red' : s.status === 'IN_PROGRESS' ? 'blue' : 'slate'} /></Td>
            <Td>{!s.meetingUrl ? <span className="text-xs text-red-600">Missing</span> : joinable ? <a href={s.meetingUrl} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">Join</a> : <span className="text-xs text-slate-400">Not joinable now</span>}</Td>
            <Td>{s._count.attendance ? `${s._count.attendance} marked` : s.status === 'COMPLETED' ? <span className="text-xs text-amber-700">Missing</span> : '—'}</Td>
            <Td>{s.recordingUrl ? <a href={s.recordingUrl} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">View</a> : s.status === 'COMPLETED' ? <span className="text-xs text-amber-700">Missing</span> : '—'}</Td>
          </tr>
        );
      })}
    </Table>
  );
}

function LectureRecordings({ id }: { id: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['batch-recordings', id], queryFn: () => api<RecordingRow[]>(`/admin/batches/${id}/recordings`) });
  const [note, setNote] = useState<Record<string, string>>({});
  async function act(recId: string, action: 'publish' | 'reject') {
    await api(`/admin/recordings/${recId}/${action}`, { method: 'POST', body: { reviewNote: note[recId] || undefined } });
    qc.invalidateQueries({ queryKey: ['batch-recordings', id] });
  }
  if (isLoading) return <Loading />;
  if (isError) return <Alert>Could not load recordings.</Alert>;
  if (!data?.length) return <Empty>No lecture recordings have been submitted for this batch yet.</Empty>;
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {data.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
          <div>
            <p className="font-medium text-slate-900">{r.title}{r.session && <span className="font-normal text-slate-500"> · {r.session.topic}</span>}</p>
            <p className="text-xs text-slate-500">Submitted {date(r.submittedAt)} · <a href={r.driveUrl} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">Open in Drive</a></p>
            {r.reviewNote && <p className="mt-1 text-xs text-slate-500">Note: {r.reviewNote}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Badge status={r.status} tone={r.status === 'PUBLISHED' ? 'green' : r.status === 'REJECTED' ? 'red' : 'amber'} />
            {r.status === 'SUBMITTED' && (
              <>
                <Input placeholder="Note (optional)" className="!w-40 !py-1 text-xs" value={note[r.id] ?? ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
                <Button variant="secondary" className="!py-1" onClick={() => act(r.id, 'publish')}>Publish</Button>
                <Button variant="danger" className="!py-1" onClick={() => act(r.id, 'reject')}>Reject</Button>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Students({ id }: { id: string }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['batch-students', id], queryFn: () => api<Student[]>(`/mentor/batches/${id}/students`) });
  if (isLoading) return <Loading />;
  if (isError) return <Alert>Could not load students.</Alert>;
  if (!data?.length) return <Empty>No enrolled students yet.</Empty>;
  return (
    <Table head={['Student', 'Current → target', 'Progress', 'Status']}>
      {data.map((s) => (
        <tr key={s.enrollmentId}>
          <Td>{s.student.firstName} {s.student.lastName}</Td>
          <Td>{s.student.currentBand ?? '—'} → {s.student.targetBand ?? '—'}</Td>
          <Td className="min-w-32"><ProgressBar value={Number(s.progressPercent)} /></Td>
          <Td><Badge status={s.status} /></Td>
        </tr>
      ))}
    </Table>
  );
}

export default function BatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'students' | 'classes' | 'recordings'>('overview');
  const { data: me } = useMe();

  const batch = useQuery({ queryKey: ['admin-batch', id], queryFn: () => api<Batch>(`/admin/batches/${id}`) });
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); } catch (e) { setError(errorMessage(e)); } };

  if (batch.isLoading) return <Loading />;
  if (batch.isError || !batch.data) return <Alert>Batch not found.</Alert>;
  const b = batch.data;
  const canEdit = can(me, 'batch.edit');

  return (
    <>
      <PageHeader title={b.name} subtitle={`${b.course.title} · starts ${date(b.startAt, true)} · ${b.days.length ? b.days.join(', ') : 'days not set'}${b.classTime ? ` at ${b.classTime}` : ''} · ${b.timezone}`} actions={<>
        <Badge status={b.status} />
        {canEdit && b.status !== 'ARCHIVED' && <Button variant="danger" onClick={() => confirm('Remove this batch? Batches with past students are archived instead of deleted.') && run(async () => { await api(`/admin/batches/${id}`, { method: 'DELETE' }); location.href = '/admin/batches'; })}>Remove</Button>}
      </>} />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      <div role="tablist" className="mb-5 flex gap-1 border-b border-slate-200">
        {([['overview', 'Overview'], ['students', 'Students'], ['classes', 'Classes & Schedule'], ['recordings', 'Lecture Recordings']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>{l}</button>
        ))}
      </div>

      {tab === 'overview' && <Overview id={id} b={b} canEdit={canEdit} run={run} />}
      {tab === 'students' && <Students id={id} />}
      {tab === 'classes' && <ClassesAndSchedule id={id} />}
      {tab === 'recordings' && <LectureRecordings id={id} />}
    </>
  );
}
