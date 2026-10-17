'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Dialog, Empty, Field, FilterBar, Input, Loading, PageHeader, ProgressBar, SearchInput, Select, Table, Td, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { can, useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { date, label } from '@/lib/format';
import type { BatchRow } from '../batches/page';

interface Row {
  id: string; status: string; source: string; enrolledAt: string | null; accessEndsAt: string | null; progressPercent: string;
  courseVersionId: string; student: { firstName: string; lastName: string; user: { email: string } }; course: { title: string }; batch: { id: string; name: string };
  planName: string;
}
const SOURCES = ['ADMIN', 'SCHOLARSHIP', 'CORPORATE', 'PROMOTION', 'MIGRATION'];
const PLANS = ['FREE', 'STARTER', 'ADVANCED', 'PREMIUM'];

function ManualEnroll({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const batches = useQuery({ queryKey: ['admin-batches', 'active'], queryFn: () => api<BatchRow[]>('/admin/batches?scope=active'), enabled: open });
  const [f, setF] = useState({ studentEmail: '', batchId: '', source: 'ADMIN', reason: '', planName: 'PREMIUM' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await api('/admin/enrollments', { method: 'POST', body: f });
      await qc.invalidateQueries({ queryKey: ['admin-enrollments'] });
      setF({ studentEmail: '', batchId: '', source: 'ADMIN', reason: '', planName: 'PREMIUM' }); onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Enroll a student manually">
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <Field label="Student email">{(p) => <Input {...p} type="email" value={f.studentEmail} onChange={(e) => setF({ ...f, studentEmail: e.target.value })} />}</Field>
        <Field label="Batch">{(p) => <Select {...p} value={f.batchId} onChange={(e) => setF({ ...f, batchId: e.target.value })}><option value="">Select…</option>{batches.data?.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.counts.enrolled} enrolled)</option>)}</Select>}</Field>
        <Field label="Source">{(p) => <Select {...p} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{SOURCES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>}</Field>
        <Field label="Plan">{(p) => <Select {...p} value={f.planName} onChange={(e) => setF({ ...f, planName: e.target.value })}>{PLANS.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>}</Field>
        <Field label="Reason (recorded in the audit log)">{(p) => <Textarea {...p} rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!f.studentEmail || !f.batchId || f.reason.trim().length < 3} onClick={submit}>Enroll</Button></div>
      </div>
    </Dialog>
  );
}

function ActionDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const qc = useQueryClient();
  const batches = useQuery({ queryKey: ['admin-batches', 'active'], queryFn: () => api<(BatchRow & { courseVersionId: string })[]>('/admin/batches?scope=active'), enabled: !!row });
  const [mode, setMode] = useState<'EXTEND' | 'PAUSE' | 'RESUME' | 'TRANSFER'>('EXTEND');
  const [days, setDays] = useState('30');
  const [toBatch, setToBatch] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const targets = (batches.data ?? []).filter((b) => row && b.courseVersionId === row.courseVersionId && b.id !== row.batch.id);

  async function run() {
    if (!row) return;
    setBusy(true); setError(null);
    try {
      if (mode === 'TRANSFER') await api('/admin/enrollments/' + row.id + '/transfer', { method: 'POST', body: { toBatchId: toBatch, reason } });
      else await api('/admin/enrollments/' + row.id + '/action', { method: 'POST', body: mode === 'EXTEND' ? { action: 'EXTEND', days: Number(days), note: reason || undefined } : { action: mode, note: reason || undefined } });
      await qc.invalidateQueries({ queryKey: ['admin-enrollments'] }); onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={!!row} onClose={onClose} title={'Manage enrollment — ' + (row ? row.student.firstName + ' ' + row.student.lastName : '')}>
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <Field label="Action">{(p) => <Select {...p} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="EXTEND">Extend access</option><option value="PAUSE">Pause</option><option value="RESUME">Resume</option><option value="TRANSFER">Transfer to another batch</option>
        </Select>}</Field>
        {mode === 'EXTEND' && <Field label="Days to add">{(p) => <Input {...p} type="number" min={1} max={730} value={days} onChange={(e) => setDays(e.target.value)} />}</Field>}
        {mode === 'TRANSFER' && <Field label="New batch" hint="Only batches running the same course version are listed.">{(p) => <Select {...p} value={toBatch} onChange={(e) => setToBatch(e.target.value)}><option value="">Select…</option>{targets.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.counts.enrolled} enrolled)</option>)}</Select>}</Field>}
        <Field label={mode === 'TRANSFER' ? 'Reason (kept in the transfer history)' : 'Note (optional, audited)'}>{(p) => <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={mode === 'TRANSFER' && (!toBatch || reason.trim().length < 3)} onClick={run}>Apply</Button></div>
      </div>
    </Dialog>
  );
}

export default function EnrollmentsPage() {
  const [manage, setManage] = useState<Row | null>(null);
  const { data: me } = useMe();
  const [status, setStatus] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-enrollments', status], queryFn: () => api<Row[]>(`/admin/enrollments${status ? `?status=${status}` : ''}`) });
  const q = search.trim().toLowerCase();
  const items = (data ?? []).filter((e) => (!q || `${e.student.firstName} ${e.student.lastName} ${e.student.user.email}`.toLowerCase().includes(q)) && (!planFilter || e.planName === planFilter));
  return (
    <>
      <PageHeader title="Enrollments" subtitle="Every student's access to a course, with where they stand." actions={can(me, 'enrollment.create') ? <Button onClick={() => setOpen(true)}>Manual enrollment</Button> : undefined} />
      <FilterBar count={data && items.length}>
        <SearchInput label="Search enrollments" placeholder="Search student name or email…" value={search} onDebounced={setSearch} />
        <div className="w-44">
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>{['ACTIVE', 'COMPLETED', 'PAUSED', 'EXPIRED', 'CANCELLED', 'SUSPENDED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </Select>
        </div>
        <div className="w-44">
          <Select aria-label="Filter by plan" value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
            <option value="">All plans</option>{PLANS.map((p) => <option key={p} value={p}>{label(p)}</option>)}
          </Select>
        </div>
      </FilterBar>
      {isLoading && <Loading />}
      {isError && <Alert>Could not load enrollments.</Alert>}
      {data && (items.length === 0 ? <Empty title="No enrollments match">Try a different search or clear the filters.</Empty> : (
        <Table head={['Student', 'Course / batch', 'Plan', 'Source', 'Enrolled', 'Access until', 'Progress', 'Status', '']} sticky>
          {items.map((e) => (
            <tr key={e.id}>
              <Td>{e.student.firstName} {e.student.lastName}<span className="block text-xs text-fg-muted">{e.student.user.email}</span></Td>
              <Td>{e.course.title}<span className="block text-xs text-fg-muted">{e.batch.name}</span></Td>
              <Td>{label(e.planName)}</Td>
              <Td>{label(e.source)}</Td><Td>{date(e.enrolledAt)}</Td><Td>{date(e.accessEndsAt)}</Td>
              <Td><div className="w-24"><ProgressBar value={Math.round(Number(e.progressPercent))} /></div></Td>
              <Td><Badge status={e.status} /></Td>
              <Td>{can(me, 'enrollment.create') && <Button variant="ghost" size="xs" onClick={() => setManage(e)}>Manage</Button>}</Td>
            </tr>
          ))}
        </Table>
      ))}
      <ManualEnroll open={open} onClose={() => setOpen(false)} />
      <ActionDialog row={manage} onClose={() => setManage(null)} />
    </>
  );
}
