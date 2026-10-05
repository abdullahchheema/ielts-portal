'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { EnrollmentBadge, METHOD_TEXT } from '@/components/student';
import { Alert, Badge, Button, Card, ClickableRow, DefinitionList, Dialog, DetailDialog, Empty, Field, Loading, PageHeader, Section, Skeleton, Table, Td, Tabs, Textarea } from '@/components/ui';
import { label } from '@/lib/format';
import { ReceiptViewer } from '@/components/ReceiptViewer';
import { TeacherApplicationDetailDialog } from '@/components/TeacherApplicationDetailDialog';
import { ApiError, api } from '@/lib/api';
import { can, useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { date, money } from '@/lib/format';

interface Application {
  id: string; status: string; displayStatus: string; submittedAt: string; enrolledAt: string | null;
  student: {
    id: string; name: string; email: string; phone: string | null; city: string | null; country: string | null; emailVerified: boolean;
    background: { testType: string | null; targetBand: string | null; examDate: string | null; ieltsHistory: string | null; ieltsOverall: string | null };
  };
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
  const qc = useQueryClient();
  const [reject, setReject] = useState(false);
  const [details, setDetails] = useState(false);
  const [reason, setReason] = useState('');
  const [allowResubmit, setAllowResubmit] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const p = a.proof;
  const mismatch = !!p?.flags.includes('AMOUNT_MISMATCH');
  const waiting = a.status === 'PENDING_PAYMENT' && p?.status === 'SUBMITTED';
  // A signed receipt link expires; retrying refetches the list so the link is re-signed.
  const refreshLinks = () => qc.invalidateQueries({ queryKey: ['applications-admin'] });

  const verify = useMutation({
    mutationFn: () => api(`/admin/applications/proofs/${p!.id}/verify`, { method: 'POST', body: { confirmAmountMismatch: mismatch } }),
    onSuccess: () => { setDetails(false); onChanged(); }, onError: (e) => setError(errorMessage(e)),
  });
  const doReject = useMutation({
    mutationFn: () => api(`/admin/applications/proofs/${p!.id}/reject`, { method: 'POST', body: { reason, allowResubmit } }),
    onSuccess: () => { setReject(false); setDetails(false); setReason(''); onChanged(); }, onError: (e) => setError(errorMessage(e)),
  });

  const actions = waiting ? (
    <>
      <Button onClick={() => { setError(null); verify.mutate(); }} busy={verify.isPending}>{mismatch ? 'Verify anyway & enroll' : 'Verify & enroll'}</Button>
      <Button variant="danger" onClick={() => { setError(null); setReject(true); }}>Reject…</Button>
    </>
  ) : null;

  return (
    <Card className="p-0">
      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-5 p-6">
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-semibold text-fg break-words">{a.student.name}</h2>
              <EnrollmentBadge status={a.status} />
              {!a.student.emailVerified && <Badge status="PENDING" tone="slate" text="Email not verified" />}
            </div>
            <p className="break-all text-sm text-fg-muted">{a.student.email}{a.student.phone ? ` · ${a.student.phone}` : ''}{a.student.city ? ` · ${a.student.city}${a.student.country ? `, ${a.student.country}` : ''}` : ''}</p>
            <p className="text-sm text-fg-muted">Batch <span className="font-medium text-fg">{a.batch.name}</span> · applied {date(a.submittedAt, true)}{a.enrolledAt ? ` · enrolled ${date(a.enrolledAt)}` : ''}</p>
          </header>

          {p && (
            <dl className="grid gap-x-6 gap-y-4 rounded-md bg-canvas p-4 ring-1 ring-inset ring-border sm:grid-cols-2">
              <Fact k="Course fee">{a.order ? money(a.order.total, a.order.currency) : '—'}</Fact>
              <Fact k="Amount entered"><span className={mismatch ? 'font-semibold text-danger' : 'font-medium'}>{money(p.claimedAmount, a.order?.currency)}</span></Fact>
              <Fact k="Method">{METHOD_TEXT[p.method] ?? p.method}</Fact>
              <Fact k="Payment date">{date(p.transferDate)}</Fact>
              <Fact k="Reference" mono>{p.reference}</Fact>
              {p.senderName && <Fact k="Paid by">{p.senderName}</Fact>}
            </dl>
          )}

          <div className="space-y-3">
            {p?.flags.map((f) => <Alert key={f} kind="warning">{FLAG_TEXT[f] ?? f}</Alert>)}
            {p?.rejectionReason && <Alert kind={a.status === 'REJECTED' ? 'error' : 'warning'}>{a.status === 'REJECTED' ? 'Rejected' : 'Proof rejected, waiting for a new upload'}: {p.rejectionReason}</Alert>}
            {!p && <Alert kind="warning">No payment proof was found for this application.</Alert>}
            {error && <Alert>{error}</Alert>}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
            {actions}
            <Button variant="secondary" onClick={() => setDetails(true)}>View full details</Button>
            {a.status === 'PENDING_PAYMENT' && p?.status === 'REJECTED' && <p className="text-sm text-fg-muted">Waiting for the student to upload a corrected proof.</p>}
          </div>
        </div>

        {p && (
          <aside className="min-w-0 border-t border-border bg-canvas p-6 md:border-l md:border-t-0">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-muted">Payment receipt</p>
            <ReceiptViewer fileUrl={p.fileUrl} fileMime={p.fileMime} alt={`Payment receipt from ${a.student.name}`} onRetry={refreshLinks} />
          </aside>
        )}
      </div>

      <DetailDialog open={details} onClose={() => setDetails(false)} title={a.student.name} subtitle={`Application · ${a.batch.name}`}>
        <div className="space-y-7">
          <div className="flex flex-wrap items-center gap-2">
            <EnrollmentBadge status={a.status} />
            {!a.student.emailVerified && <Badge status="PENDING" tone="slate" text="Email not verified" />}
            {p && <Badge status={p.status} />}
          </div>
          {error && <Alert>{error}</Alert>}
          <Section title="Student">
            <DefinitionList items={[
              { label: 'Full name', value: a.student.name },
              { label: 'Email', value: <span className="break-all">{a.student.email}</span> },
              { label: 'Phone', value: a.student.phone },
              { label: 'City', value: a.student.city },
              { label: 'Country', value: a.student.country },
              { label: 'Email verified', value: a.student.emailVerified ? 'Yes' : 'No' },
            ]} />
            <h3 className="mb-2 mt-5 text-sm font-semibold text-fg">Background</h3>
            <DefinitionList items={[
              { label: 'Test', value: a.student.background.testType ? (a.student.background.testType === 'GENERAL' ? 'General Training' : 'Academic') : '—' },
              { label: 'Target band', value: a.student.background.targetBand ?? '—' },
              { label: 'Planned exam date', value: a.student.background.examDate ? date(a.student.background.examDate) : '—' },
              { label: 'Taken IELTS before', value: a.student.background.ieltsHistory === 'TAKEN' ? 'Yes' : a.student.background.ieltsHistory === 'NEVER' ? 'No, first time' : '—' },
              { label: 'Latest overall band', value: a.student.background.ieltsOverall ?? '—' },
            ]} />
          </Section>
          <Section title="Application">
            <DefinitionList items={[
              { label: 'Batch', value: a.batch.name },
              { label: 'Status', value: label(a.status) },
              { label: 'Submitted', value: date(a.submittedAt, true) },
              { label: 'Enrolled', value: a.enrolledAt ? date(a.enrolledAt, true) : 'Not yet' },
              { label: 'Order reference', value: a.order?.reference ?? '—' },
              { label: 'Discount', value: a.order ? money(a.order.discount, a.order.currency) : '—' },
            ]} />
          </Section>
          {p && (
            <Section title="Payment">
              <DefinitionList items={[
                { label: 'Course fee', value: a.order ? money(a.order.total, a.order.currency) : '—' },
                { label: 'Amount entered', value: <span className={mismatch ? 'font-semibold text-danger' : ''}>{money(p.claimedAmount, a.order?.currency)}</span> },
                { label: 'Method', value: METHOD_TEXT[p.method] ?? p.method },
                { label: 'Transaction reference', value: <span className="font-mono text-xs">{p.reference}</span> },
                { label: 'Payment date', value: date(p.transferDate) },
                { label: 'Paid by', value: p.senderName || '—' },
                { label: 'Proof status', value: label(p.status) },
                { label: 'Student may resubmit', value: p.allowResubmit ? 'Yes' : 'No' },
              ]} />
              {p.flags.length > 0 && <div className="mt-4 space-y-2">{p.flags.map((f) => <Alert key={f} kind="warning">{FLAG_TEXT[f] ?? f}</Alert>)}</div>}
              {p.rejectionReason && <div className="mt-4"><Alert kind="warning">Last rejection reason: {p.rejectionReason}</Alert></div>}
            </Section>
          )}
          {p && (
            <Section title="Receipt">
              <ReceiptViewer fileUrl={p.fileUrl} fileMime={p.fileMime} alt={`Payment receipt from ${a.student.name}`} onRetry={refreshLinks} />
            </Section>
          )}
          {actions && <div className="flex flex-wrap gap-2 border-t border-border pt-5">{actions}</div>}
        </div>
      </DetailDialog>

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
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['teacher-applications-admin', status], queryFn: () => api<TeacherAppPage>(`/admin/teacher-applications?status=${status}`) });

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
      {isError && <Alert>{error instanceof ApiError && error.status === 403 ? 'Your role cannot review teacher applications. A super admin can grant Teacher management in Staff & roles.' : `Could not load teacher applications. ${errorMessage(error)}`}</Alert>}
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
  const me = useMe().data;
  const canTeachers = !!me && can(me, 'teacher.manage');
  const [mode, setMode] = useState<'students' | 'teachers'>(params.get('tab') === 'teachers' && canTeachers ? 'teachers' : 'students');
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
          items={[{ key: 'students', label: 'Students' }, ...(canTeachers ? [{ key: 'teachers', label: 'Teachers' }] : [])]}
        />
      </div>
      {mode === 'students' ? <StudentApplications openId={openId} /> : <TeacherApplications openId={openId} />}
    </>
  );
}

export default function ApplicationsPage() {
  return <Suspense fallback={<Loading />}><ApplicationsPageInner /></Suspense>;
}
