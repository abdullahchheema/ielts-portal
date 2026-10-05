'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { DAY_TEXT } from '@/components/student';
import { Alert, Badge, Button, Dialog, Empty, Field, Input, Loading, PageHeader, Select, Table, Td, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { can, useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { date, label } from '@/lib/format';

export interface BatchRow {
  id: string; name: string; status: string; startAt: string; endAt: string | null; days: string[]; classTime: string | null; deliveryMode: string;
  mentorAssigned: boolean; counts: { pending: number; enrolled: number };
  mentors: { mentorRole: string; mentor: { id: string; displayName: string } }[];
}
interface Teacher { id: string; displayName: string; status: string }

const DAYS = Object.keys(DAY_TEXT);

function CreateBatch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const teachers = useQuery({ queryKey: ['admin-mentors'], queryFn: () => api<Teacher[]>('/admin/mentors'), enabled: open && can(me, 'mentor.assign') });
  const blank = { name: '', description: '', startAt: '', endAt: '', classTime: '19:00', deliveryMode: 'ONLINE', mentorId: '', status: 'OPEN' };
  const [f, setF] = useState(blank);
  const [days, setDays] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const iso = (v: string) => (v ? new Date(v).toISOString() : undefined);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const created = await api<{ id: string }>('/admin/batches', { method: 'POST', body: {
        name: f.name, description: f.description || undefined, startAt: iso(f.startAt), endAt: iso(f.endAt), days, classTime: f.classTime || undefined,
        deliveryMode: f.deliveryMode, mentors: f.mentorId ? [{ mentorId: f.mentorId, mentorRole: 'MAIN' }] : undefined,
      } });
      if (f.status === 'OPEN') await api(`/admin/batches/${created.id}`, { method: 'PATCH', body: { status: 'OPEN' } });
      await qc.invalidateQueries({ queryKey: ['admin-batches'] });
      setF(blank); setDays([]);
      onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New batch">
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <Field label="Batch name">{(p) => <Input {...p} placeholder="IELTS January 2027" value={f.name} onChange={(e) => set('name', e.target.value)} />}</Field>
        <Field label="Description (optional)">{(p) => <Textarea {...p} rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">{(p) => <Input {...p} type="datetime-local" value={f.startAt} onChange={(e) => set('startAt', e.target.value)} />}</Field>
          <Field label="Ends (optional)">{(p) => <Input {...p} type="datetime-local" value={f.endAt} onChange={(e) => set('endAt', e.target.value)} />}</Field>
          <Field label="Class time">{(p) => <Input {...p} type="time" value={f.classTime} onChange={(e) => set('classTime', e.target.value)} />}</Field>
          <Field label="Delivery">{(p) => <Select {...p} value={f.deliveryMode} onChange={(e) => set('deliveryMode', e.target.value)}><option value="ONLINE">Online</option><option value="ONSITE">Onsite</option><option value="HYBRID">Hybrid</option></Select>}</Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-fg">Class days</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => (
              <label key={d} className={`cursor-pointer rounded-md px-3 py-1.5 text-sm ring-1 ring-inset ${days.includes(d) ? 'bg-primary-soft font-medium text-primary ring-primary' : 'ring-border-strong hover:bg-canvas'}`}>
                <input type="checkbox" className="sr-only" checked={days.includes(d)} onChange={() => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))} />{DAY_TEXT[d]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Teacher (optional)" hint="You can assign one later. Students can apply either way.">{(p) => <Select {...p} value={f.mentorId} onChange={(e) => set('mentorId', e.target.value)}><option value="">Not assigned yet</option>{teachers.data?.filter((t) => t.status === 'ACTIVE').map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}</Select>}</Field>
          <Field label="Enrollment">{(p) => <Select {...p} value={f.status} onChange={(e) => set('status', e.target.value)}><option value="OPEN">Open now</option><option value="DRAFT">Keep as draft</option></Select>}</Field>
        </div>
        <div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={f.name.trim().length < 2 || !f.startAt} onClick={submit}>Create batch</Button></div>
      </div>
    </Dialog>
  );
}

export default function BatchesPage() {
  const { data: me } = useMe();
  const [scope, setScope] = useState('');
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-batches', scope], queryFn: () => api<BatchRow[]>(`/admin/batches${scope ? `?scope=${scope}` : ''}`) });
  return (
    <>
      <PageHeader title="Batches" subtitle="Batches have no size limit. A batch without a teacher can still take applications." actions={can(me, 'batch.create') ? <Button onClick={() => setOpen(true)}>New batch</Button> : undefined} />
      <div className="mb-4 max-w-xs">
        <Select aria-label="Filter batches" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">All batches</option><option value="active">Active</option><option value="upcoming">Upcoming</option><option value="completed">Completed / closed</option>
        </Select>
      </div>
      {isLoading && <Loading />}
      {isError && <Alert>Could not load batches.</Alert>}
      {data && (data.length === 0 ? <Empty>No batches yet.</Empty> : (
        <Table head={['Batch', 'Starts', 'Schedule', 'Students', 'Teacher', 'Status', '']}>
          {data.map((b) => (
            <tr key={b.id}>
              <Td className="font-medium">{b.name}<span className="block text-xs font-normal text-fg-muted">{label(b.deliveryMode)}</span></Td>
              <Td>{date(b.startAt)}</Td>
              <Td>{b.days.length ? b.days.map((d) => DAY_TEXT[d]).join(', ') : '—'}{b.classTime ? ` · ${b.classTime}` : ''}</Td>
              <Td>{b.counts.enrolled} enrolled{b.counts.pending > 0 && <span className="block text-xs text-amber-700">{b.counts.pending} pending</span>}</Td>
              <Td>{b.mentorAssigned ? b.mentors.map((m) => m.mentor.displayName).join(', ') : <Badge status="DRAFT" tone="amber" text="Not assigned" />}</Td>
              <Td><Badge status={b.status} /></Td>
              <Td><Link href={`/admin/batches/${b.id}`} className="text-primary hover:underline">Manage</Link></Td>
            </tr>
          ))}
        </Table>
      ))}
      <CreateBatch open={open} onClose={() => setOpen(false)} />
    </>
  );
}
