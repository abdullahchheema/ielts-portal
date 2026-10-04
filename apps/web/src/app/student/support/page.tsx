'use client';

import { SkeletonTable } from '@/components/ui';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Dialog, Empty, Field, Input, Loading, PageHeader, Select, Table, Td, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date, label } from '@/lib/format';

interface Ticket { id: string; subject: string; category: string; status: string; createdAt: string }
const CATEGORIES = ['ACCOUNT', 'PAYMENT', 'COURSE', 'TECHNICAL', 'CLASS', 'ASSESSMENT', 'MENTOR', 'OTHER'];

export default function SupportPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['tickets'], queryFn: () => api<Ticket[]>('/me/tickets') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ category: 'COURSE', subject: '', description: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        <Table head={['Subject', 'Category', 'Status', 'Opened', '']}>
          {data.map((t) => <tr key={t.id}><Td className="font-medium">{t.subject}</Td><Td>{label(t.category)}</Td><Td><Badge status={t.status} /></Td><Td>{date(t.createdAt)}</Td><Td><Link href={`/student/support/${t.id}`} className="text-primary hover:underline">Open</Link></Td></tr>)}
        </Table>
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
