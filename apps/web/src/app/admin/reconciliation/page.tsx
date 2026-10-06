'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Empty, Loading, PageHeader, Section, Select, StatCard, Table, Td, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface Summary { matched: number; mismatched: number; duplicate: number; pendingReview: number; unmatched: number; submitted: number; approved: number; rejected: number; note: string }
interface Exception { id: string; status: string; reasons: string[]; proof: { bankTxnReference: string; paymentMethod: string; claimedAmount: string; payment: { order: { reference: string } } } }
interface Flag { proofId: string; reference: string; orderReference: string; student: string; overall: string | null; proofStatus: string; flags: { id: string; rule: string; level: string; reason: string }[] }

const METHODS = ['BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'OTHER'] as const;

/** Finance: imported statements, the matches they produced, the exceptions to decide, and payment risk flags to review. */
export default function ReconciliationPage() {
  const qc = useQueryClient();
  const summary = useQuery({ queryKey: ['recon-summary'], queryFn: () => api<Summary>('/admin/reconciliation/summary') });
  const exceptions = useQuery({ queryKey: ['recon-exceptions'], queryFn: () => api<Exception[]>('/admin/reconciliation/exceptions') });
  const risk = useQuery({ queryKey: ['payment-risk'], queryFn: () => api<Flag[]>('/admin/payment-risk') });
  const [method, setMethod] = useState<(typeof METHODS)[number]>('BANK_TRANSFER');
  const [csv, setCsv] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Parses reference,amount,date lines. Anything malformed is reported rather than silently skipped. */
  function parse(text: string) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out: { reference: string; amount: number; date: string }[] = [];
    const bad: string[] = [];
    lines.forEach((line, i) => {
      const [reference, amount, date] = line.split(',').map((p) => p.trim());
      if (!reference || !(Number(amount) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) bad.push(`Line ${i + 1}`);
      else out.push({ reference, amount: Number(amount), date });
    });
    return { out, bad };
  }

  async function importCsv() {
    setError(null); setMessage(null);
    const { out, bad } = parse(csv);
    if (bad.length) { setError(`Could not read ${bad.join(', ')}. Use reference,amount,YYYY-MM-DD.`); return; }
    setBusy(true);
    try {
      const r = await api<{ rows: number; checked: number; matched: number }>('/admin/reconciliation/imports', { method: 'POST', body: { method, lines: out } });
      setMessage(`Imported ${r.rows} lines. ${r.matched} of ${r.checked} payments matched.`);
      setCsv('');
      await qc.invalidateQueries({ queryKey: ['recon-summary'] });
      await qc.invalidateQueries({ queryKey: ['recon-exceptions'] });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function resolve(id: string, resolution: 'ACCEPTED' | 'REJECTED_EXCEPTION') {
    setError(null);
    try {
      await api(`/admin/reconciliation/exceptions/${id}/resolve`, { method: 'POST', body: { resolution } });
      await qc.invalidateQueries({ queryKey: ['recon-exceptions'] });
    } catch (e) { setError(errorMessage(e)); }
  }

  async function review(flagId: string, decision: 'DISMISS' | 'CONFIRM') {
    setError(null);
    try {
      await api(`/admin/payment-risk/${flagId}/review`, { method: 'POST', body: { decision } });
      await qc.invalidateQueries({ queryKey: ['payment-risk'] });
    } catch (e) { setError(errorMessage(e)); }
  }

  return (
    <>
      <PageHeader title="Reconciliation" subtitle="Match payments against the statements you import. Decisions here are recorded; they never change a payment on their own." />
      {error && <Alert>{error}</Alert>}
      {message && <Alert kind="success">{message}</Alert>}

      {summary.isLoading && <Loading />}
      {summary.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Matched" value={summary.data.matched} />
            <StatCard label="Mismatched" value={summary.data.mismatched} attention={summary.data.mismatched > 0} />
            <StatCard label="Duplicate" value={summary.data.duplicate} attention={summary.data.duplicate > 0} />
            <StatCard label="Pending review" value={summary.data.pendingReview} />
            <StatCard label="Unmatched" value={summary.data.unmatched} />
          </div>
          <p className="mt-2 text-xs text-fg-subtle">{summary.data.note}</p>
        </>
      )}

      <Section title="Import a statement">
        <Card className="max-w-3xl space-y-3">
          <p className="text-sm text-fg-muted">One line per transaction: <code>reference,amount,YYYY-MM-DD</code>. Export the file from your bank or wallet and paste it here.</p>
          <Select aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])}>
            {METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ').toLowerCase()}</option>)}
          </Select>
          <Textarea aria-label="Statement lines" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'TXN123456,45000,2026-09-28'} />
          <div className="flex justify-end">
            <Button onClick={importCsv} busy={busy} disabled={csv.trim().length === 0}>Import lines</Button>
          </div>
        </Card>
      </Section>

      <Section title="Exceptions to decide">
        {exceptions.isLoading && <Loading />}
        {exceptions.data && (exceptions.data.length === 0 ? <Empty title="No exceptions" /> : (
          <Table head={['Reference', 'Order', 'Status', 'Why', '']}>
            {exceptions.data.map((x) => (
              <tr key={x.id}>
                <Td className="font-mono text-xs">{x.proof.bankTxnReference}</Td>
                <Td>{x.proof.payment.order.reference}</Td>
                <Td>{x.status.toLowerCase().replace('_', ' ')}</Td>
                <Td className="max-w-md text-sm text-fg-muted">{x.reasons.join(' ')}</Td>
                <Td>
                  <div className="flex gap-2">
                    <Button variant="secondary" className="!py-1" onClick={() => resolve(x.id, 'ACCEPTED')}>Accept</Button>
                    <Button variant="ghost" className="!py-1" onClick={() => resolve(x.id, 'REJECTED_EXCEPTION')}>Flag</Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        ))}
      </Section>

      <Section title="Payment risk to review" description="Flags explain the concern. A person decides; nothing is rejected automatically.">
        {risk.isLoading && <Loading />}
        {risk.data && (risk.data.length === 0 ? <Empty title="No open flags" /> : (
          <ul className="space-y-3">
            {risk.data.map((p) => (
              <li key={p.proofId}>
                <Card className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-fg">{p.orderReference} · {p.student}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.overall === 'HIGH' ? 'bg-danger-soft text-danger' : p.overall === 'MEDIUM' ? 'bg-warning-soft text-warning' : 'bg-info-soft text-info'}`}>{(p.overall ?? 'LOW').toLowerCase()} risk</span>
                  </div>
                  <ul className="space-y-2">
                    {p.flags.map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="text-fg-muted">{f.reason}</span>
                        <span className="flex gap-2">
                          <Button variant="secondary" className="!py-1" onClick={() => review(f.id, 'DISMISS')}>Dismiss</Button>
                          <Button variant="ghost" className="!py-1" onClick={() => review(f.id, 'CONFIRM')}>Confirm concern</Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            ))}
          </ul>
        ))}
      </Section>
    </>
  );
}
