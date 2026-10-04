'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { EnrollmentBadge, METHOD_TEXT } from '@/components/student';
import { Alert, Badge, Button, Card, ClickableRow, Dialog, Empty, Field, Loading, PageHeader, Skeleton, Table, Td, Tabs, Textarea } from '@/components/ui';
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
const TABS = [['PENDING', 'Pending', 'pending'], ['ENROLLED', 'Verified & enrolled', 'enrolled'], ['REJECTED', 'Rejected', 'rejected'], ['ALL', 'All', null]] as const;

/** One label/value row in the payment summary. */
function Fact({ k, children, mono }: { k: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-fg-muted">{k}</dt>
      <dd className={`mt-0.5 text-sm text-fg break-words ${mono ? 'font-mono text-xs' : ''}`}>{children}</dd>
    </div>
  );
}

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
    <Card className="p-0">
      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-5 p-6">
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-semibold text-fg">{a.student.name}</h2>
              <EnrollmentBadge status={a.status} />
              {!a.student.emailVerified && <Badge status="PENDING" tone="slate" text="Email not verified" />}
            </div>
            <p className="text-sm text-fg-muted break-words">{a.student.email}{a.student.phone ? ` · ${a.student.phone}` : ''}{a.student.city ? ` · ${a.student.city}${a.student.country ? `, ${a.student.country}` : ''}` : ''}</p>
            <p className="text-sm text-fg-muted">Batch <span className="font-medium text-fg">{a.batch.name}</span> · applied {date(a.submittedAt, true)}{a.enrolledAt ? ` · enrolled ${date(a.enrolledAt)}` : ''}</p>
          </header>

          {p && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-md bg-canvas p-4 ring-1 ring-inset ring-border sm:grid-cols-3">
              <Fact k="Course fee">{a.order ? money(a.order.total, a.order.currency) : '—'}</Fact>
              <Fact k="Amount entered"><span className={mismatch ? 'font-semibold text-danger' : 'font-medium'}>{money(p.claimedAmount, a.order?.currency)}</span></Fact>
              <Fact k="Method">{METHOD_TEXT[p.method] ?? p.method}</Fact>
              <Fact k="Reference" mono>{p.reference}</Fact>
              <Fact k="Payment date">{date(p.transferDate)}</Fact>
              {p.senderName && <Fact k="Paid by">{p.senderName}</Fact>}
            </dl>
          )}

          <div className="space-y-3">
            {p?.flags.map((f) => <Alert key={f} kind="warning">{FLAG_TEXT[f] ?? f}</Alert>)}
            {p?.rejectionReason && <Alert kind={a.status === 'REJECTED' ? 'error' : 'warning'}>{a.status === 'REJECTED' ? 'Rejected' : 'Proof rejected, waiting for a new upload'}: {p.rejectionReason}</Alert>}
            {!p && <Alert kind="warning">No payment proof was found for this application.</Alert>}
            {error && <Alert>{error}</Alert>}
          </div>

          {waiting && (
            <div className="flex flex-wrap gap-2 border-t border-border pt-5">
              <Button onClick={() => { setError(null); verify.mutate(); }} busy={verify.isPending}>{mismatch ? 'Verify anyway & enroll' : 'Verify & enroll'}</Button>
              <Button variant="danger" onClick={() => { setError(null); setReject(true); }}>Reject…</Button>
            </div>
          )}
          {a.status === 'PENDING_PAYMENT' && p?.status === 'REJECTED' && <p className="border-t border-border pt-5 text-sm text-fg-muted">Waiting for the student to upload a corrected proof.</p>}
        </div>

        {p && (
          <aside className="border-t border-border bg-canvas p-6 md:border-l md:border-t-0">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-muted">Payment proof</p>
            <a href={p.fileUrl} target="_blank" rel="noopener noreferrer" className="group block overflow-hidden rounded-md bg-surface ring-1 ring-border transition-shadow duration-150 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label="Open payment proof in a new tab">
              {isPdf
                ? <div className="flex h-44 items-center justify-center text-sm font-medium text-fg-muted">PDF receipt. Open to view.</div>
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={p.fileUrl} alt={`Payment proof from ${a.student.name}`} className="max-h-72 w-full object-contain" />}
            </a>
          </aside>
        )}
      </div>

      <Dialog open={reject} onClose={() => setReject(false)} title="Reject application">
        <div className="space-y-4">
          <Field label="Reason (shown to the student)" hint="Be specific so the student knows what to correct.">{(f) => <Textarea {...f} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <label className="flex items-start gap-2.5 text-sm text-fg">
            <input type="checkbox" className="mt-0.5 size-4 rounded border-border-strong accent-primary" checked={allowResubmit} onChange={(e) => setAllowResubmit(e.target.checked)} />
            <span>Let the student upload a corrected proof</span>
          </label>
          {!allowResubmit && <Alert kind="warning">The application will be closed as rejected.</Alert>}
          {error && <Alert>{error}</Alert>}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setReject(false)}>Cancel</Button>
            <Button variant="danger" busy={doReject.isPending} disabled={reason.trim().length < 3} onClick={() => doReject.mutate()}>Reject application</Button>
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
      <div className="mb-6 overflow-x-auto">
        <Tabs
          aria-label="Application status"
          variant="segment"
          value={status}
          onChange={(k) => setStatus(k as (typeof TABS)[number][0])}
          items={TABS.map(([k, l, c]) => ({ key: k, label: l, count: c && data ? data.counts[c] : undefined }))}
        />
      </div>
      {isLoading && <div className="space-y-4"><Skeleton className="h-48 rounded-lg" /><Skeleton className="h-48 rounded-lg" /></div>}
      {isError && <Alert>Could not load applications.</Alert>}
      {data && (data.items.length === 0 ? <Empty title={status === 'PENDING' ? 'You are all caught up' : 'Nothing here'}>{status === 'PENDING' ? 'No applications are waiting for a payment check.' : 'No applications match this filter.'}</Empty> : (
        <div className="space-y-4">
          {data.items.map((a) => (
            <div key={a.id} ref={(el) => { refs.current[a.id] = el; }} className={a.id === openId ? 'rounded-lg ring-2 ring-primary' : undefined}>
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
      <div className="mb-6 overflow-x-auto">
        <Tabs
          aria-label="Teacher application status"
          variant="segment"
          value={status}
          onChange={(k) => setStatus(k as (typeof TEACHER_TABS)[number][0])}
          items={TEACHER_TABS.map(([k, l, c]) => ({ key: k, label: l, count: c && data ? data.counts[c] : undefined }))}
        />
      </div>
      {isLoading && <Loading />}
      {isError && <Alert>Could not load teacher applications.</Alert>}
      {data && (data.items.length === 0 ? <Empty title="Nothing here">No teacher applications match this filter.</Empty> : (
        <Table head={['Name', 'Email', 'Phone', 'City', 'Subjects', 'Status', 'Submitted']}>
          {data.items.map((a) => (
            <ClickableRow key={a.id} onClick={() => setViewId(a.id)} className={a.id === openId ? 'bg-primary-soft/50 ring-2 ring-inset ring-primary' : undefined}>
              <Td className="font-medium">{a.fullName}</Td><Td>{a.email}</Td><Td>{a.phone}</Td><Td>{a.city ?? '—'}</Td>
              <Td>{a.subjects.join(', ') || '—'}</Td><Td><Badge status={a.status} /></Td><Td className="tabular-nums">{date(a.submittedAt)}</Td>
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
      <div className="mb-6">
        <Tabs
          aria-label="Application type"
          variant="underline"
          value={mode}
          onChange={(k) => setMode(k as 'students' | 'teachers')}
          items={[{ key: 'students', label: 'Students' }, { key: 'teachers', label: 'Teachers' }]}
        />
      </div>
      {mode === 'students' ? <StudentApplications openId={openId} /> : <TeacherApplications openId={openId} />}
    </>
  );
}

export default function ApplicationsPage() {
  return <Suspense fallback={<Loading />}><ApplicationsPageInner /></Suspense>;
}
