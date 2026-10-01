'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Empty, Field, Input, Loading, PageHeader, ProgressBar, Select, Table, Td } from '@/components/ui';
import { IeltsBadge, IeltsSummaryLike } from '@/components/IeltsSummary';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { band, date, label } from '@/lib/format';

interface Student { enrollmentId: string; status: string; progressPercent: string; enrolledAt: string | null; student: { firstName: string; lastName: string; currentBand: string | null; targetBand: string | null } }
interface Session { id: string; topic: string; startsAt: string; endsAt: string; provider: string | null; meetingUrl: string | null; recordingUrl: string | null; _count: { attendance: number } }
interface Sheet { session: { id: string; topic: string }; roster: { studentId: string; name: string; status: string | null; minutesAttended: number | null }[] }
interface ResultRow { studentId: string; name: string; targetBand: number | null; progressPercent: number; skills: Record<string, { latest: number | null; best: number | null }>; lastMock: { title: string; percent: number | null; at: string } | null; ielts?: IeltsSummaryLike }
const STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];

function AttendanceDialog({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['sheet', sessionId], queryFn: () => api<Sheet>(`/mentor/sessions/${sessionId}/attendance`), enabled: !!sessionId });
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = (r: Sheet['roster'][number]) => marks[r.studentId] ?? r.status ?? '';

  async function save() {
    if (!data) return;
    const records = data.roster.filter((r) => value(r)).map((r) => ({ studentId: r.studentId, status: value(r) }));
    setBusy(true); setError(null);
    try { await api(`/mentor/sessions/${sessionId}/attendance`, { method: 'PUT', body: { records } }); await qc.invalidateQueries({ queryKey: ['sessions-mentor'] }); await qc.invalidateQueries({ queryKey: ['sheet', sessionId] }); setMarks({}); onClose(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open={!!sessionId} onClose={onClose} title={`Attendance — ${data?.session.topic ?? ''}`}>
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        {data && (
          <>
            <div className="flex justify-end"><Button variant="ghost" className="!py-1 text-xs" onClick={() => setMarks(Object.fromEntries(data.roster.map((r) => [r.studentId, 'PRESENT'])))}>Mark everyone present</Button></div>
            <ul className="max-h-80 divide-y divide-slate-100 overflow-auto text-sm">
              {data.roster.map((r) => (
                <li key={r.studentId} className="flex items-center justify-between gap-3 py-2">
                  <span>{r.name}</span>
                  <Select aria-label={`Attendance for ${r.name}`} className="!w-32" value={value(r)} onChange={(e) => setMarks({ ...marks, [r.studentId]: e.target.value })}><option value="">—</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save attendance</Button></div>
      </div>
    </Dialog>
  );
}

function NewSession({ batchId, open, onClose }: { batchId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ topic: '', startsAt: '', endsAt: '', provider: 'ZOOM', meetingUrl: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true); setError(null);
    try {
      await api(`/mentor/batches/${batchId}/sessions`, { method: 'POST', body: { topic: f.topic, startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(f.endsAt).toISOString(), provider: f.provider, meetingUrl: f.meetingUrl || undefined } });
      await qc.invalidateQueries({ queryKey: ['sessions-mentor', batchId] }); setF({ topic: '', startsAt: '', endsAt: '', provider: 'ZOOM', meetingUrl: '' }); onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Schedule a live class">
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <Field label="Topic">{(p) => <Input {...p} value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">{(p) => <Input {...p} type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />}</Field>
          <Field label="Ends">{(p) => <Input {...p} type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />}</Field>
          <Field label="Platform">{(p) => <Select {...p} value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}><option value="ZOOM">Zoom</option><option value="GOOGLE_MEET">Google Meet</option><option value="TEAMS">Microsoft Teams</option><option value="OTHER">Other</option></Select>}</Field>
          <Field label="Meeting link (https)">{(p) => <Input {...p} type="url" value={f.meetingUrl} onChange={(e) => setF({ ...f, meetingUrl: e.target.value })} />}</Field>
        </div>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!f.topic.trim() || !f.startsAt || !f.endsAt} onClick={create}>Schedule</Button></div>
      </div>
    </Dialog>
  );
}

function Results({ batchId }: { batchId: string }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['mentor-results', batchId], queryFn: () => api<ResultRow[]>(`/mentor/batches/${batchId}/results`) });
  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>Could not load results.</Alert>;
  if (!data.length) return <Empty>No enrolled students yet.</Empty>;
  const SK = ['LISTENING', 'READING', 'WRITING', 'SPEAKING'];
  return (
    <Table head={['Student', 'IELTS', 'Target', ...SK.map((k) => label(k)), 'Last mock', 'Progress']}>
      {data.map((r) => (
        <tr key={r.studentId}>
          <Td className="font-medium">{r.name}</Td>
          <Td><IeltsBadge ielts={r.ielts} /></Td>
          <Td>{band(r.targetBand)}</Td>
          {SK.map((k) => <Td key={k}>{r.skills[k]?.latest === null || r.skills[k] === undefined ? '—' : <span title={`Best ${band(r.skills[k].best)}`}>{band(r.skills[k].latest)}</span>}</Td>)}
          <Td>{r.lastMock ? <span title={r.lastMock.title}>{r.lastMock.percent === null ? '—' : `${Math.round(r.lastMock.percent)}%`} <span className="text-xs text-slate-400">{date(r.lastMock.at)}</span></span> : '—'}</Td>
          <Td className="min-w-32"><ProgressBar value={r.progressPercent} /></Td>
        </tr>
      ))}
    </Table>
  );
}

export default function MentorBatchPage() {
  const { id } = useParams<{ id: string }>();
  const students = useQuery({ queryKey: ['mentor-students', id], queryFn: () => api<Student[]>(`/mentor/batches/${id}/students`) });
  const sessions = useQuery({ queryKey: ['sessions-mentor', id], queryFn: () => api<Session[]>(`/mentor/batches/${id}/sessions`) });
  const [sheet, setSheet] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [tab, setTab] = useState<'students' | 'classes' | 'results'>('classes');
  if (students.isLoading) return <Loading />;
  if (students.isError) return <Alert>{errorMessage(students.error)}</Alert>;
  const now = Date.now();

  return (
    <>
      <PageHeader title="Batch" subtitle={`${students.data?.length ?? 0} enrolled student${students.data?.length === 1 ? '' : 's'}`} actions={<Button onClick={() => setNewOpen(true)}>Schedule class</Button>} />

      <div role="tablist" className="mb-5 flex gap-1 border-b border-slate-200">
        {([['classes', 'Classes & attendance'], ['students', 'Students'], ['results', 'Results']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>{l}</button>
        ))}
      </div>

      {tab === 'results' && <Results batchId={id} />}
      {tab === 'classes' && <>
      {!sessions.data?.length ? <Empty>No classes scheduled yet.</Empty> : (
        <Table head={['Class', 'When', 'Platform', 'Attendance', '']}>
          {sessions.data.map((s) => {
            const past = new Date(s.endsAt).getTime() < now;
            return (
              <tr key={s.id}>
                <Td className="font-medium">{s.topic}</Td><Td>{date(s.startsAt, true)}</Td><Td>{s.provider ? label(s.provider) : '—'}</Td>
                <Td>{s._count.attendance ? <Badge status="COMPLETED" tone="green" /> : past ? <Badge status="PENDING" tone="amber" /> : '—'}{s._count.attendance ? ` ${s._count.attendance} marked` : ''}</Td>
                <Td><Button variant="secondary" className="!py-1" onClick={() => setSheet(s.id)}>Attendance</Button></Td>
              </tr>
            );
          })}
        </Table>
      )}

      </>}
      {tab === 'students' && <>
      {!students.data?.length ? <Empty>No students enrolled yet.</Empty> : (
        <Table head={['Student', 'Current → target', 'Progress', 'Enrolled', 'Status']}>
          {students.data.map((s) => (
            <tr key={s.enrollmentId}>
              <Td className="font-medium">{s.student.firstName} {s.student.lastName}</Td>
              <Td>{band(s.student.currentBand)} → {band(s.student.targetBand)}</Td>
              <Td className="min-w-40"><ProgressBar value={Number(s.progressPercent)} /></Td>
              <Td>{date(s.enrolledAt)}</Td><Td><Badge status={s.status} /></Td>
            </tr>
          ))}
        </Table>
      )}
      </>}
      <NewSession batchId={id} open={newOpen} onClose={() => setNewOpen(false)} />
      <AttendanceDialog sessionId={sheet} onClose={() => setSheet(null)} />
    </>
  );
}
