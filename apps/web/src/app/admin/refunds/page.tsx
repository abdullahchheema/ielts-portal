'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Dialog, Empty, Field, Input, Loading, PageHeader, Select, Table, Td, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date, money } from '@/lib/format';

interface Refund {
  id: string; status: string; amount: string; reason: string; createdAt: string; providerReference: string | null; decisionNote: string | null;
  payment: { amount: string; currency: string; order: { reference: string; student: { firstName: string; lastName: string; user: { email: string } } } };
}

export default function RefundsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('REQUESTED');
  const { data, isLoading, isError } = useQuery({ queryKey: ['refunds', status], queryFn: () => api<Refund[]>('/admin/refunds' + (status ? '?status=' + status : '')) });
  const [target, setTarget] = useState<{ r: Refund; mode: 'process' | 'reject' } | null>(null);
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act() {
    if (!target) return;
    setBusy(true); setError(null);
    try {
      await api('/admin/refunds/' + target.r.id + '/' + target.mode, { method: 'POST', body: target.mode === 'process' ? { providerReference: ref, note: note || undefined } : { note } });
      await qc.invalidateQueries({ queryKey: ['refunds'] }); setTarget(null); setRef(''); setNote('');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Refunds" subtitle="Send the money back from your bank first, then record the bank reference here. A full refund ends the student’s access and frees the seat." />
      <div className="mb-4 max-w-xs"><Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="REQUESTED">Awaiting decision</option><option value="PROCESSED">Refunded</option><option value="REJECTED">Declined</option><option value="">All</option></Select></div>
      {isLoading && <Loading />}
      {isError && <Alert>Could not load refunds.</Alert>}
      {data && (data.length === 0 ? <Empty>Nothing here.</Empty> : (
        <Table head={['Order', 'Student', 'Amount', 'Reason', 'Requested', 'Status', '']}>
          {data.map((r) => (
            <tr key={r.id}>
              <Td className="font-mono text-xs">{r.payment.order.reference}</Td>
              <Td>{r.payment.order.student.firstName} {r.payment.order.student.lastName}<span className="block text-xs text-slate-500">{r.payment.order.student.user.email}</span></Td>
              <Td>{money(r.amount, r.payment.currency)}<span className="block text-xs text-slate-500">of {money(r.payment.amount, r.payment.currency)}</span></Td>
              <Td className="max-w-xs">{r.reason}{r.decisionNote && <span className="block text-xs text-slate-500">Note: {r.decisionNote}</span>}{r.providerReference && <span className="block font-mono text-xs text-slate-500">{r.providerReference}</span>}</Td>
              <Td>{date(r.createdAt)}</Td><Td><Badge status={r.status} /></Td>
              <Td>{r.status === 'REQUESTED' && <span className="flex gap-1"><Button className="!py-1" onClick={() => { setError(null); setTarget({ r, mode: 'process' }); }}>Mark refunded</Button><Button variant="ghost" className="!py-1 text-red-600" onClick={() => { setError(null); setTarget({ r, mode: 'reject' }); }}>Decline</Button></span>}</Td>
            </tr>
          ))}
        </Table>
      ))}
      <Dialog open={!!target} onClose={() => setTarget(null)} title={target?.mode === 'process' ? 'Record refund payout' : 'Decline refund request'}>
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          {target?.mode === 'process' && <Field label="Bank reference of your payout">{(p) => <Input {...p} value={ref} onChange={(e) => setRef(e.target.value)} />}</Field>}
          <Field label={target?.mode === 'process' ? 'Note (optional)' : 'Reason shown to the student'}>{(p) => <Textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setTarget(null)}>Cancel</Button>
            <Button variant={target?.mode === 'reject' ? 'danger' : 'primary'} busy={busy} disabled={target?.mode === 'process' ? ref.trim().length < 3 : note.trim().length < 3} onClick={act}>{target?.mode === 'process' ? 'Confirm refunded' : 'Decline'}</Button></div>
        </div>
      </Dialog>
    </>
  );
}
