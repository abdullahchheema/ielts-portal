'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EnrollmentBadge, METHOD_TEXT } from '@/components/student';
import { Alert, Badge, Button, Card, Dialog, Empty, Field, Loading, PageHeader, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date, money } from '@/lib/format';

interface Application {
  id: string; status: string; displayStatus: string; submittedAt: string; enrolledAt: string | null;
  student: { id: string; name: string; email: string; phone: string | null; city: string | null; country: string | null; emailVerified: boolean };
  batch: { id: string; name: string };
  order: { reference: string; total: string; discount: string; currency: string } | null;
  proof: {
    id: string; status: string; method: string; reference: string; senderName: string; claimedAmount: string; transferDate: string; flags: string[];
    rejectionReason: string | null; allowResubmit: boolean; fileMime: string; fileUrl: string;
  } | null;
}
interface Page { total: number; counts: { pending: number; enrolled: number; rejected: number }; items: Application[] }

const FLAG_TEXT: Record<string, string> = {
  AMOUNT_MISMATCH: 'The amount entered differs from the course fee.',
  DUPLICATE_TXN_REFERENCE: 'This reference number appears on another application.',
};
const TABS = [['PENDING', 'Pending applications', 'pending'], ['ENROLLED', 'Verified & enrolled', 'enrolled'], ['REJECTED', 'Rejected', 'rejected'], ['ALL', 'All', null]] as const;

function ApplicationCard({ a, onChanged }: { a: Application; onChanged: () => void }) {
  const [reject, setReject] = useState(false);
  const [reason, setReason] = useState('');
  const [allowResubmit, setAllowResubmit] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const p = a.proof;
  const mismatch = !!p?.flags.includes('AMOUNT_MISMATCH');
  const isPdf = p?.fileMime === 'application/pdf';
  const waiting = a.status === 'PENDING_PAYMENT' && p?.status === 'SUBMITTED';

  const verify = useMutation({
    mutationFn: () => api(`/admin/applications/proofs/${p!.id}/verify`, { method: 'POST', body: { confirmAmountMismatch: mismatch } }),
    onSuccess: onChanged, onError: (e) => setError(errorMessage(e)),
  });
  const doReject = useMutation({
    mutationFn: () => api(`/admin/applications/proofs/${p!.id}/reject`, { method: 'POST', body: { reason, allowResubmit } }),
    onSuccess: () => { setReject(false); setReason(''); onChanged(); }, onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Card>
      <div className="grid gap-5 md:grid-cols-[1fr_15rem]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{a.student.name}</h2><EnrollmentBadge status={a.status} />
            {!a.student.emailVerified && <Badge status="PENDING" tone="slate" text="Email not verified" />}
          </div>
          <p className="text-sm text-slate-600">{a.student.email}{a.student.phone ? ` · ${a.student.phone}` : ''}{a.student.city ? ` · ${a.student.city}${a.student.country ? `, ${a.student.country}` : ''}` : ''}</p>
          <p className="text-sm text-slate-600">Batch <strong>{a.batch.name}</strong> · applied {date(a.submittedAt, true)}{a.enrolledAt ? ` · enrolled ${date(a.enrolledAt)}` : ''}</p>
          {p && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">Course fee</dt><dd className="font-semibold">{a.order ? money(a.order.total, a.order.currency) : '—'}</dd>
              <dt className="text-slate-500">Amount entered</dt><dd className={`font-semibold ${mismatch ? 'text-red-600' : ''}`}>{money(p.claimedAmount, a.order?.currency)}</dd>
              <dt className="text-slate-500">Method</dt><dd>{METHOD_TEXT[p.method] ?? p.method}</dd>
              <dt className="text-slate-500">Reference</dt><dd className="break-all font-mono text-xs">{p.reference}</dd>
              <dt className="text-slate-500">Payment date</dt><dd>{date(p.transferDate)}</dd>
              {p.senderName && <><dt className="text-slate-500">Paid by</dt><dd>{p.senderName}</dd></>}
            </dl>
          )}
          {p?.flags.map((f) => <Alert key={f} kind="warning">{FLAG_TEXT[f] ?? f}</Alert>)}
          {p?.rejectionReason && <Alert kind={a.status === 'REJECTED' ? 'error' : 'warning'}>{a.status === 'REJECTED' ? 'Rejected' : 'Proof rejected, waiting for a new upload'}: {p.rejectionReason}</Alert>}
          {!p && <Alert kind="warning">No payment proof was found for this application.</Alert>}
          {error && <Alert>{error}</Alert>}
          {waiting && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={() => { setError(null); verify.mutate(); }} busy={verify.isPending}>{mismatch ? 'Verify anyway & enroll' : 'Verify & enroll'}</Button>
              <Button variant="danger" onClick={() => { setError(null); setReject(true); }}>Reject…</Button>
            </div>
          )}
          {a.status === 'PENDING_PAYMENT' && p?.status === 'REJECTED' && <p className="text-sm text-slate-500">Waiting for the student to upload a corrected proof.</p>}
        </div>
        {p && (
          <a href={p.fileUrl} target="_blank" rel="noopener noreferrer" className="block h-fit overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200" aria-label="Open payment proof in a new tab">
            {isPdf ? <div className="flex h-40 items-center justify-center text-sm text-slate-600">PDF receipt — click to open</div>
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={p.fileUrl} alt={`Payment proof from ${a.student.name}`} className="max-h-72 w-full object-contain" />}
          </a>
        )}
      </div>

      <Dialog open={reject} onClose={() => setReject(false)} title="Reject application">
        <div className="space-y-4">
          <Field label="Reason (shown to the student)">{(f) => <Textarea {...f} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allowResubmit} onChange={(e) => setAllowResubmit(e.target.checked)} /> Let the student upload a corrected proof</label>
          {!allowResubmit && <Alert kind="warning">The application will be closed as rejected.</Alert>}
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReject(false)}>Cancel</Button>
            <Button variant="danger" busy={doReject.isPending} disabled={reason.trim().length < 3} onClick={() => doReject.mutate()}>Reject</Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}

export default function ApplicationsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof TABS)[number][0]>('PENDING');
  const { data, isLoading, isError } = useQuery({ queryKey: ['applications-admin', status], queryFn: () => api<Page>(`/admin/applications?status=${status}&take=50`) });
  const changed = () => { qc.invalidateQueries({ queryKey: ['applications-admin'] }); qc.invalidateQueries({ queryKey: ['admin-dashboard'] }); };

  return (
    <>
      <PageHeader title="Applications" subtitle="Check each payment, then verify it. Verifying enrolls the student and opens their portal." />
      <div role="tablist" aria-label="Application status" className="mb-4 flex flex-wrap gap-2">
        {TABS.map(([k, l, c]) => (
          <button key={k} role="tab" aria-selected={status === k} onClick={() => setStatus(k)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${status === k ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50'}`}>
            {l}{c && data ? ` (${data.counts[c]})` : ''}
          </button>
        ))}
      </div>
      {isLoading && <Loading />}
      {isError && <Alert>Could not load applications.</Alert>}
      {data && (data.items.length === 0 ? <Empty>{status === 'PENDING' ? 'No applications are waiting. You are all caught up.' : 'Nothing here.'}</Empty> : (
        <div className="space-y-4">{data.items.map((a) => <ApplicationCard key={a.id} a={a} onChanged={changed} />)}</div>
      ))}
    </>
  );
}
