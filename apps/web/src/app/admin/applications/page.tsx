'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { EnrollmentBadge, METHOD_TEXT } from '@/components/student';
import { Alert, Badge, Button, Card, ClickableRow, Dialog, Empty, Field, Loading, PageHeader, Table, Td, Textarea } from '@/components/ui';
import { TeacherApplicationDetailDialog } from '@/components/TeacherApplicationDetailDialog';
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

interface TeacherAppRow { id: string; fullName: string; email: string; phone: string; city: string | null; status: string; subjects: string[]; submittedAt: string; reviewedAt: string | null }
interface TeacherAppPage { total: number; counts: { pending: number; approved: number; rejected: number }; items: TeacherAppRow[] }
const TEACHER_TABS = [['PENDING', 'Pending', 'pending'], ['APPROVED', 'Approved', 'approved'], ['REJECTED', 'Rejected', 'rejected'], ['ALL', 'All', null]] as const;

function StudentApplications({ openId }: { openId: string | null }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof TABS)[number][0]>('PENDING');
  const { data, isLoading, isError } = useQuery({ queryKey: ['applications-admin', status], queryFn: () => api<Page>(`/admin/applications?status=${status}&take=50`) });
  const changed = () => { qc.invalidateQueries({ queryKey: ['applications-admin'] }); qc.invalidateQueries({ queryKey: ['admin-dashboard'] }); };
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (openId && refs.current[openId]) refs.current[openId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [openId, data]);

  return (
    <>
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
        <div className="space-y-4">
          {data.items.map((a) => (
            <div key={a.id} ref={(el) => { refs.current[a.id] = el; }} className={a.id === openId ? 'rounded-lg ring-2 ring-indigo-500' : undefined}>
              <ApplicationCard a={a} onChanged={changed} />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function TeacherApplications({ openId }: { openId: string | null }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof TEACHER_TABS)[number][0]>('PENDING');
  const [viewId, setViewId] = useState<string | null>(openId);
  const { data, isLoading, isError } = useQuery({ queryKey: ['teacher-applications-admin', status], queryFn: () => api<TeacherAppPage>(`/admin/teacher-applications?status=${status}`) });

  useEffect(() => { if (openId) setViewId(openId); }, [openId]);
  const changed = () => qc.invalidateQueries({ queryKey: ['teacher-applications-admin'] });

  return (
    <>
      <div role="tablist" aria-label="Teacher application status" className="mb-4 flex flex-wrap gap-2">
        {TEACHER_TABS.map(([k, l, c]) => (
          <button key={k} role="tab" aria-selected={status === k} onClick={() => setStatus(k)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${status === k ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50'}`}>
            {l}{c && data ? ` (${data.counts[c]})` : ''}
          </button>
        ))}
      </div>
      {isLoading && <Loading />}
      {isError && <Alert>Could not load teacher applications.</Alert>}
      {data && (data.items.length === 0 ? <Empty>Nothing here.</Empty> : (
        <Table head={['Name', 'Email', 'Phone', 'City', 'Subjects', 'Status', 'Submitted']}>
          {data.items.map((a) => (
            <ClickableRow key={a.id} onClick={() => setViewId(a.id)} className={a.id === openId ? 'ring-2 ring-inset ring-indigo-500' : undefined}>
              <Td className="font-medium">{a.fullName}</Td><Td>{a.email}</Td><Td>{a.phone}</Td><Td>{a.city ?? '—'}</Td>
              <Td>{a.subjects.join(', ') || '—'}</Td><Td><Badge status={a.status} /></Td><Td>{date(a.submittedAt)}</Td>
            </ClickableRow>
          ))}
        </Table>
      ))}
      <TeacherApplicationDetailDialog applicationId={viewId} onClose={() => setViewId(null)} onChanged={changed} />
    </>
  );
}

function ApplicationsPageInner() {
  const params = useSearchParams();
  const [mode, setMode] = useState<'students' | 'teachers'>(params.get('tab') === 'teachers' ? 'teachers' : 'students');
  const openId = params.get('open');

  return (
    <>
      <PageHeader title="Applications" subtitle="Check each payment, then verify it. Verifying enrolls the student and opens their portal." />
      <div className="mb-5 inline-flex rounded-md bg-slate-100 p-1 text-sm">
        <button className={`rounded px-3 py-1.5 font-medium ${mode === 'students' ? 'bg-white shadow-sm' : 'text-slate-600'}`} onClick={() => setMode('students')}>Students</button>
        <button className={`rounded px-3 py-1.5 font-medium ${mode === 'teachers' ? 'bg-white shadow-sm' : 'text-slate-600'}`} onClick={() => setMode('teachers')}>Teachers</button>
      </div>
      {mode === 'students' ? <StudentApplications openId={openId} /> : <TeacherApplications openId={openId} />}
    </>
  );
}

export default function ApplicationsPage() {
  return <Suspense fallback={<Loading />}><ApplicationsPageInner /></Suspense>;
}
