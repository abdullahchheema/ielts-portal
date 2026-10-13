'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Empty, Field, Input, Loading, PageHeader, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface PlanItem {
  id: string; title: string; plannedFor: string; estimatedMinutes: number | null; status: 'PLANNED' | 'DONE' | 'SKIPPED'; notes: string | null;
  contentItem: { id: string; title: string; module: string | null } | null;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function StudyPlanPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['study-plan'], queryFn: () => api<PlanItem[]>('/me/study-plan') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', plannedFor: todayISO(), estimatedMinutes: '' as string, notes: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function create() {
    setBusy(true); setFormError(null);
    try {
      await api('/me/study-plan', { method: 'POST', body: { title: f.title, plannedFor: f.plannedFor, estimatedMinutes: f.estimatedMinutes ? Number(f.estimatedMinutes) : undefined, notes: f.notes || undefined } });
      await qc.invalidateQueries({ queryKey: ['study-plan'] });
      setOpen(false); setF({ title: '', plannedFor: todayISO(), estimatedMinutes: '', notes: '' });
    } catch (e) { setFormError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function setStatus(id: string, status: 'DONE' | 'SKIPPED' | 'PLANNED') {
    await api(`/me/study-plan/${id}`, { method: 'PATCH', body: { status } });
    qc.invalidateQueries({ queryKey: ['study-plan'] });
  }
  async function remove(id: string) {
    await api(`/me/study-plan/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['study-plan'] });
  }

  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>{errorMessage(error)}</Alert>;

  const today = todayISO();
  const overdue = data.filter((i) => i.status === 'PLANNED' && i.plannedFor.slice(0, 10) < today);
  const upcoming = data.filter((i) => i.status === 'PLANNED' && i.plannedFor.slice(0, 10) >= today);
  const done = data.filter((i) => i.status !== 'PLANNED');

  const Row = ({ i }: { i: PlanItem }) => (
    <li className="flex items-start justify-between gap-3 py-2.5 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-900">{i.title}</span>
          <Badge status={i.status} />
        </div>
        <div className="mt-0.5 text-xs text-slate-500">
          {date(i.plannedFor)}{i.estimatedMinutes ? ` · ${i.estimatedMinutes} min` : ''}{i.contentItem ? ` · ${i.contentItem.title}` : ''}
        </div>
        {i.notes && <p className="mt-1 text-xs text-slate-600">{i.notes}</p>}
      </div>
      <div className="flex shrink-0 gap-2 text-xs">
        {i.status === 'PLANNED' && <>
          <button onClick={() => setStatus(i.id, 'DONE')} className="font-medium text-green-700 hover:underline">Mark done</button>
          <button onClick={() => setStatus(i.id, 'SKIPPED')} className="font-medium text-slate-500 hover:underline">Skip</button>
        </>}
        {i.status !== 'PLANNED' && <button onClick={() => setStatus(i.id, 'PLANNED')} className="font-medium text-slate-500 hover:underline">Reopen</button>}
        <button onClick={() => remove(i.id)} className="font-medium text-red-700 hover:underline">Remove</button>
      </div>
    </li>
  );

  return (
    <>
      <PageHeader title="Study Plan" subtitle="When you plan to learn it — separate from My Course, which is what to learn." actions={<Button onClick={() => setOpen(true)}>Add plan item</Button>} />
      {!data.length ? <Empty>You have not planned any study sessions yet.</Empty> : (
        <>
          {overdue.length > 0 && <Card className="mb-4"><h2 className="mb-2 font-semibold text-red-700">Overdue</h2><ul className="divide-y divide-slate-100">{overdue.map((i) => <Row key={i.id} i={i} />)}</ul></Card>}
          <Card className="mb-4"><h2 className="mb-2 font-semibold text-slate-900">Upcoming</h2>{upcoming.length === 0 ? <p className="text-sm text-slate-500">Nothing planned yet.</p> : <ul className="divide-y divide-slate-100">{upcoming.map((i) => <Row key={i.id} i={i} />)}</ul>}</Card>
          {done.length > 0 && <Card><h2 className="mb-2 font-semibold text-slate-900">Completed / Skipped</h2><ul className="divide-y divide-slate-100">{done.map((i) => <Row key={i.id} i={i} />)}</ul></Card>}
        </>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Add a plan item">
        <div className="space-y-3">
          {formError && <Alert>{formError}</Alert>}
          <Field label="What will you study?">{(p) => <Input {...p} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <Field label="Date">{(p) => <Input {...p} type="date" value={f.plannedFor} onChange={(e) => setF({ ...f, plannedFor: e.target.value })} />}</Field>
          <Field label="Estimated minutes (optional)">{(p) => <Input {...p} type="number" min={1} value={f.estimatedMinutes} onChange={(e) => setF({ ...f, estimatedMinutes: e.target.value })} />}</Field>
          <Field label="Notes (optional)">{(p) => <Textarea {...p} rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button busy={busy} disabled={f.title.trim().length < 1} onClick={create}>Add</Button></div>
        </div>
      </Dialog>
    </>
  );
}
