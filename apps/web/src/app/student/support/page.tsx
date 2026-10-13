'use client';

import { SkeletonTable } from '@/components/ui';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Dialog, Empty, Field, FilterBar, Input, Loading, PageHeader, Select, Table, Td, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date, label } from '@/lib/format';

interface Ticket { id: string; subject: string; category: string; status: string; createdAt: string }
const CATEGORIES = ['ACCOUNT', 'PAYMENT', 'COURSE', 'TECHNICAL', 'CLASS', 'ASSESSMENT', 'MENTOR', 'OTHER'];
const STATUSES = ['OPEN', 'PENDING_REVIEW', 'UNDER_REVIEW', 'CLOSED'];

export default function SupportPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['tickets'], queryFn: () => api<Ticket[]>('/me/tickets') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ category: 'COURSE', subject: '', description: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const statusOptions = useMemo(() => Array.from(new Set([...STATUSES, ...(data?.map((t) => t.status) ?? [])])), [data]);
  const filtered = useMemo(
    () => (data ?? []).filter((t) => (!categoryFilter || t.category === categoryFilter) && (!statusFilter || t.status === statusFilter)),
    [data, categoryFilter, statusFilter],
  );

  async function create() {
    setBusy(true); setError(null);
    try { await api('/me/tickets', { method: 'POST', body: f }); await qc.invalidateQueries({ queryKey: ['tickets'] }); setOpen(false); setF({ category: 'COURSE', subject: '', description: '' }); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  if (isLoading) return <SkeletonTable rows={6} cols={5} />;
  return (
    <>
      <PageHeader title="Support" subtitle="Questions about payments, classes or your account? We’ll reply here and by email." actions={<Button onClick={() => setOpen(true)}>New request</Button>} />
      {!data?.length ? <Empty>You have no support requests.</Empty> : (
        <>
          <FilterBar count={filtered.length}>
            <Select aria-label="Filter by category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-auto">
              <option value="">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
            </Select>
            <Select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto">
              <option value="">All statuses</option>
              {statusOptions.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </Select>
          </FilterBar>
          {filtered.length === 0 ? <Empty title="No matching requests">Try a different filter.</Empty> : (
            <Table head={['Subject', 'Category', 'Status', 'Opened', '']}>
              {filtered.map((t) => <tr key={t.id}><Td className="font-medium">{t.subject}</Td><Td>{label(t.category)}</Td><Td><Badge status={t.status} /></Td><Td>{date(t.createdAt)}</Td><Td><Link href={`/student/support/${t.id}`} className="text-primary hover:underline">Open</Link></Td></tr>)}
            </Table>
          )}
        </>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="New support request">
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <Field label="Topic">{(p) => <Select {...p} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>}</Field>
          <Field label="Subject">{(p) => <Input {...p} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />}</Field>
          <Field label="What happened?">{(p) => <Textarea {...p} rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button busy={busy} disabled={f.subject.trim().length < 3 || f.description.trim().length < 5} onClick={create}>Send</Button></div>
        </div>
      </Dialog>
    </>
  );
}
