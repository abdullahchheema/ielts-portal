'use client';

import { SkeletonTable } from '@/components/ui';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Accordion, Alert, Badge, Button, Card, Dialog, Empty, Field, Input, Loading, PageHeader, ProgressBar, Select, SimpleList, SimpleListItem, Table, Tabs, Td } from '@/components/ui';
import { BatchAnalytics } from './batch-analytics';
import { AttendanceHistory } from './attendance-history';
import { IeltsBadge, IeltsSummaryLike } from '@/components/IeltsSummary';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { band, date, label } from '@/lib/format';

interface Student { enrollmentId: string; status: string; progressPercent: string; enrolledAt: string | null; student: { id: string; firstName: string; lastName: string; currentBand: string | null; targetBand: string | null } }
interface Session { id: string; topic: string; startsAt: string; endsAt: string; provider: string | null; meetingUrl: string | null; recordingUrl: string | null; status: string; _count: { attendance: number } }
interface Sheet { session: { id: string; topic: string }; roster: { studentId: string; name: string; status: string | null; minutesAttended: number | null }[] }
interface ResultRow { studentId: string; name: string; targetBand: number | null; progressPercent: number; skills: Record<string, { latest: number | null; best: number | null }>; lastMock: { title: string; percent: number | null; at: string } | null; ielts?: IeltsSummaryLike }
interface CurriculumTreeItem { id: string; title: string; teacherAssignable: boolean; module: string | null }
interface CurriculumTreeSection { id: string; title: string; items: CurriculumTreeItem[]; children: CurriculumTreeSection[] }
interface CurriculumAssignment { id: string; requirement: string; classification: string; dueAt: string | null; publishedAt: string | null; completedCount: number; studentCount: number; contentItem: { id: string; title: string; module: string | null } }
const STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];
const flattenCurriculum = (s: CurriculumTreeSection): CurriculumTreeItem[] => [...s.items, ...s.children.flatMap(flattenCurriculum)];

function AttendanceDialog({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['sheet', sessionId], queryFn: () => api<Sheet>(`/mentor/sessions/${sessionId}/attendance`), enabled: !!sessionId });
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = (r: Sheet['roster'][number]) => marks[r.studentId] ?? r.status ?? '';

  async function save() {
    if (!data) return;
    const records = data.roster.filter((r) => value(r)).map((r) => ({ studentId: r.studentId, status: value(r), ...(notes[r.studentId] !== undefined ? { note: notes[r.studentId] } : {}) }));
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
            <div className="flex justify-end"><Button variant="ghost" size="xs" onClick={() => setMarks(Object.fromEntries(data.roster.map((r) => [r.studentId, 'PRESENT'])))}>Mark everyone present</Button></div>
            <div className="max-h-80 overflow-auto">
              <SimpleList>
                {data.roster.map((r) => (
                  <SimpleListItem
                    key={r.studentId}
                    left={<span className="min-w-0 flex-1 truncate">{r.name}</span>}
                    right={
                      <>
                        <Input aria-label={`Note for ${r.name}`} placeholder="Note (optional)" maxLength={500} className="!w-44" value={notes[r.studentId] ?? ''} onChange={(e) => setNotes({ ...notes, [r.studentId]: e.target.value })} />
                        <Select aria-label={`Attendance for ${r.name}`} className="!w-32" value={value(r)} onChange={(e) => setMarks({ ...marks, [r.studentId]: e.target.value })}><option value="">—</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
                      </>
                    }
                  />
                ))}
              </SimpleList>
            </div>
          </>
        )}
        {sessionId && (
          <Accordion items={[{ key: 'history', title: 'Correction history', content: <AttendanceHistory sessionId={sessionId} /> }]} />
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

function AssignCurriculumDialog({ batchId, open, onClose }: { batchId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const tree = useQuery({ queryKey: ['mentor-curriculum'], queryFn: () => api<{ sections: CurriculumTreeSection[] }>('/mentor/curriculum'), enabled: open });
  const [f, setF] = useState({ contentItemId: '', requirement: 'REQUIRED', classification: 'GENERAL', dueAt: '', instructions: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const items = (tree.data?.sections ?? []).flatMap(flattenCurriculum).filter((i) => i.teacherAssignable);

  async function assign() {
    setBusy(true); setError(null);
    try {
      await api('/mentor/curriculum-assignments', {
        method: 'POST',
        body: { contentItemId: f.contentItemId, batchId, requirement: f.requirement, classification: f.classification, dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : undefined, instructions: f.instructions || undefined, publish: true },
      });
      await qc.invalidateQueries({ queryKey: ['curriculum-assignments', batchId] });
      setF({ contentItemId: '', requirement: 'REQUIRED', classification: 'GENERAL', dueAt: '', instructions: '' });
      onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Assign a curriculum item">
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <Field label="Activity">{(p) => (
          <Select {...p} value={f.contentItemId} onChange={(e) => setF({ ...f, contentItemId: e.target.value })}>
            <option value="">Select an activity…</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.module ? `[${label(i.module)}] ` : ''}{i.title}</option>)}
          </Select>
        )}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Requirement">{(p) => <Select {...p} value={f.requirement} onChange={(e) => setF({ ...f, requirement: e.target.value })}><option value="REQUIRED">Required</option><option value="RECOMMENDED">Recommended</option></Select>}</Field>
          <Field label="Classification">{(p) => <Select {...p} value={f.classification} onChange={(e) => setF({ ...f, classification: e.target.value })}><option value="GENERAL">General</option><option value="PRE_CLASS">Pre-class</option><option value="POST_CLASS">Post-class</option><option value="HOMEWORK">Homework</option></Select>}</Field>
          <Field label="Due date (optional)">{(p) => <Input {...p} type="datetime-local" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} />}</Field>
        </div>
        <Field label="Instructions (optional)">{(p) => <Input {...p} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />}</Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!f.contentItemId} onClick={assign}>Assign</Button></div>
      </div>
    </Dialog>
  );
}

function Curriculum({ batchId }: { batchId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({ queryKey: ['curriculum-assignments', batchId], queryFn: () => api<CurriculumAssignment[]>(`/mentor/batches/${batchId}/curriculum-assignments`) });
  async function remove(id: string) { await api(`/mentor/curriculum-assignments/${id}`, { method: 'DELETE' }); qc.invalidateQueries({ queryKey: ['curriculum-assignments', batchId] }); }
  if (isLoading) return <Loading />;
  if (isError) return <Alert>Could not load assignments.</Alert>;
  return (
    <>
      <div className="mb-3 flex justify-end"><Button onClick={() => setOpen(true)}>Assign activity</Button></div>
      {!data?.length ? <Empty>No curriculum has been assigned to this batch yet.</Empty> : (
        <Table head={['Activity', 'Requirement', 'Classification', 'Due', 'Completion', '']}>
          {data.map((a) => (
            <tr key={a.id}>
              <Td className="font-medium">{a.contentItem.title}</Td>
              <Td><Badge status={a.requirement} tone={a.requirement === 'REQUIRED' ? 'blue' : 'slate'} /></Td>
              <Td>{label(a.classification)}</Td>
              <Td>{a.dueAt ? date(a.dueAt, true) : '—'}</Td>
              <Td>{a.completedCount}/{a.studentCount}</Td>
              <Td><button onClick={() => remove(a.id)} className="text-xs font-medium text-red-700 hover:underline">Remove</button></Td>
            </tr>
          ))}
        </Table>
      )}
      <AssignCurriculumDialog batchId={batchId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

interface TeacherRecording { id: string; title: string; status: string; driveUrl: string; reviewNote: string | null; session: { topic: string } | null }

function SubmitRecordingDialog({ batchId, open, onClose }: { batchId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: '', driveUrl: '', description: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError(null);
    try {
      await api('/mentor/recordings', { method: 'POST', body: { batchId, title: f.title, driveUrl: f.driveUrl, description: f.description || undefined } });
      await qc.invalidateQueries({ queryKey: ['mentor-recordings', batchId] });
      setF({ title: '', driveUrl: '', description: '' }); onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Submit a lecture recording">
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <Field label="Title">{(p) => <Input {...p} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Google Drive share link" hint="Share the file with your students' Google accounts, or an institutional Drive, before submitting — a working link does not by itself guarantee access.">
          {(p) => <Input {...p} type="url" placeholder="https://drive.google.com/file/d/..." value={f.driveUrl} onChange={(e) => setF({ ...f, driveUrl: e.target.value })} />}
        </Field>
        <Field label="Description (optional)">{(p) => <Input {...p} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!f.title.trim() || !f.driveUrl.trim()} onClick={submit}>Submit</Button></div>
      </div>
    </Dialog>
  );
}

function Recordings({ batchId }: { batchId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({ queryKey: ['mentor-recordings', batchId], queryFn: () => api<TeacherRecording[]>(`/mentor/recordings?batchId=${batchId}`) });
  if (isLoading) return <Loading />;
  if (isError) return <Alert>Could not load recordings.</Alert>;
  return (
    <>
      <div className="mb-3 flex justify-end"><Button onClick={() => setOpen(true)}>Submit recording</Button></div>
      {!data?.length ? <Empty>You have not submitted any recordings for this batch yet.</Empty> : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white px-4">
          {data.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div>
                <p className="font-medium text-slate-900">{r.title}{r.session && <span className="font-normal text-slate-500"> · {r.session.topic}</span>}</p>
                {r.reviewNote && <p className="text-xs text-slate-500">{r.reviewNote}</p>}
              </div>
              <Badge status={r.status} tone={r.status === 'PUBLISHED' ? 'green' : r.status === 'REJECTED' ? 'red' : 'amber'} />
            </li>
          ))}
        </ul>
      )}
      <SubmitRecordingDialog batchId={batchId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function Results({ batchId }: { batchId: string }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['mentor-results', batchId], queryFn: () => api<ResultRow[]>(`/mentor/batches/${batchId}/results`) });
  if (isLoading) return <SkeletonTable rows={6} cols={5} />;
  if (isError || !data) return <Alert>Could not load results.</Alert>;
  if (!data.length) return <Empty>No enrolled students yet.</Empty>;
  const SK = ['LISTENING', 'READING', 'WRITING', 'SPEAKING'];
  return (
    <Table sticky head={['Student', 'IELTS', 'Target', ...SK.map((k) => label(k)), 'Last mock', 'Progress']}>
      {data.map((r) => (
        <tr key={r.studentId}>
          <Td className="font-medium">{r.name}</Td>
          <Td><IeltsBadge ielts={r.ielts} /></Td>
          <Td>{band(r.targetBand)}</Td>
          {SK.map((k) => <Td key={k}>{r.skills[k]?.latest === null || r.skills[k] === undefined ? '—' : <span title={`Best ${band(r.skills[k].best)}`}>{band(r.skills[k].latest)}</span>}</Td>)}
          <Td>{r.lastMock ? <span title={r.lastMock.title}>{r.lastMock.percent === null ? '—' : `${Math.round(r.lastMock.percent)}%`} <span className="text-xs text-fg-subtle">{date(r.lastMock.at)}</span></span> : '—'}</Td>
          <Td className="min-w-32"><ProgressBar value={r.progressPercent} compact /></Td>
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
  const [tab, setTab] = useState<'students' | 'classes' | 'results' | 'analytics' | 'curriculum' | 'recordings'>('classes');
  const qc = useQueryClient();
  if (students.isLoading) return <Loading />;
  if (students.isError) return <Alert>{errorMessage(students.error)}</Alert>;
  const now = Date.now();

  async function act(sessionId: string, action: 'start' | 'complete' | 'cancel') {
    await api(`/mentor/sessions/${sessionId}/${action}`, { method: 'POST' });
    qc.invalidateQueries({ queryKey: ['sessions-mentor', id] });
  }

  return (
    <>
      <PageHeader title="Batch" subtitle={`${students.data?.length ?? 0} enrolled student${students.data?.length === 1 ? '' : 's'}`} actions={<Button onClick={() => setNewOpen(true)}>Schedule class</Button>} />

      <div className="mb-5 overflow-x-auto">
        <Tabs
          aria-label="Batch sections"
          variant="underline"
          value={tab}
          onChange={(k) => setTab(k as typeof tab)}
          items={[{ key: 'classes', label: 'Classes & attendance' }, { key: 'students', label: 'Students' }, { key: 'curriculum', label: 'Curriculum' }, { key: 'recordings', label: 'Recordings' }, { key: 'results', label: 'Results' }, { key: 'analytics', label: 'Analytics' }]}
        />
      </div>
      {tab === 'analytics' && <BatchAnalytics batchId={id} />}

      {tab === 'curriculum' && <Curriculum batchId={id} />}
      {tab === 'results' && <Results batchId={id} />}
      {tab === 'recordings' && <Recordings batchId={id} />}
      {tab === 'classes' && <>
      {!sessions.data?.length ? <Empty>No classes scheduled yet.</Empty> : (
        <Table sticky head={['Class', 'When', 'Status', 'Attendance', '']}>
          {sessions.data.map((s) => {
            const past = new Date(s.endsAt).getTime() < now;
            const joinable = s.meetingUrl && now >= new Date(s.startsAt).getTime() - 15 * 60_000 && now <= new Date(s.endsAt).getTime();
            return (
              <tr key={s.id}>
                <Td className="font-medium">{s.topic}</Td><Td>{date(s.startsAt, true)}</Td>
                <Td><Badge status={s.status} tone={s.status === 'COMPLETED' ? 'green' : s.status === 'CANCELLED' ? 'red' : s.status === 'IN_PROGRESS' ? 'blue' : 'slate'} /></Td>
                <Td>{s._count.attendance ? <Badge status="RECORDED" tone="green" text={`${s._count.attendance} marked`} /> : past ? <Badge status="PENDING" tone="amber" /> : '—'}</Td>
                <Td className="space-x-2 whitespace-nowrap">
                  {joinable && <a href={s.meetingUrl!} target="_blank" rel="noreferrer" className="text-xs font-medium text-success hover:underline">Join</a>}
                  {s.status === 'SCHEDULED' && <button onClick={() => act(s.id, 'start')} className="text-xs font-medium text-primary hover:underline">Start</button>}
                  {s.status === 'IN_PROGRESS' && <button onClick={() => act(s.id, 'complete')} className="text-xs font-medium text-primary hover:underline">Complete</button>}
                  {(s.status === 'SCHEDULED' || s.status === 'IN_PROGRESS') && <button onClick={() => act(s.id, 'cancel')} className="text-xs font-medium text-danger hover:underline">Cancel</button>}
                  <Button variant="secondary" size="xs" onClick={() => setSheet(s.id)}>Attendance</Button>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}

      </>}
      {tab === 'students' && <>
      {!students.data?.length ? <Empty>No students enrolled yet.</Empty> : (
        <Table sticky head={['Student', 'Current → target', 'Progress', 'Enrolled', 'Status']}>
          {students.data.map((s) => (
            <tr key={s.enrollmentId}>
              <Td className="font-medium">{s.student.firstName} {s.student.lastName}</Td>
              <Td>{band(s.student.currentBand)} → {band(s.student.targetBand)}</Td>
              <Td className="min-w-40"><ProgressBar value={Number(s.progressPercent)} compact /></Td>
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
