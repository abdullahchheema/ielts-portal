'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Loading, PageHeader, Textarea } from '@/components/ui';
import { Application, EnrollmentBadge, METHOD_TEXT, PaymentPendingNotice, scheduleText, teacherText, useApplications } from '@/components/student';
import { PaymentSection, PaymentValues, emptyPayment, paymentFormData, validatePayment } from '@/components/PaymentSection';
import { ReceiptViewer } from '@/components/ReceiptViewer';
import { api } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { date, money } from '@/lib/format';

const STEPS = ['Submitted', 'Payment verification', 'Enrolled'];

function Timeline({ app }: { app: Application }) {
  const step = app.status === 'PENDING_PAYMENT' ? 1 : app.status === 'REJECTED' ? 1 : 2;
  return (
    <ol className="mb-4 flex items-center gap-2 text-sm" aria-label="Application progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${app.status === 'REJECTED' && i === 1 ? 'bg-danger text-white' : i <= step ? 'bg-primary text-white' : 'bg-surface-muted text-fg-muted'}`}>{i < step || (i === step && app.status === 'ACTIVE') ? '✓' : i + 1}</span>
          <span className={i <= step ? 'font-medium text-fg' : 'text-fg-subtle'}>{s}</span>
          {i < STEPS.length - 1 && <span aria-hidden className="mx-1 h-px w-6 bg-slate-300" />}
        </li>
      ))}
    </ol>
  );
}

function Resubmit({ app }: { app: Application }) {
  const qc = useQueryClient();
  const [v, setV] = useState<PaymentValues>(() => emptyPayment(app.order?.total ?? ''));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const send = useMutation({
    mutationFn: () => api(`/applications/${app.id}/payment-proof`, { form: paymentFormData(v) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['applications'] }),
  });
  const submit = async () => {
    const e = validatePayment(v);
    setErrors(e);
    if (Object.keys(e).length) return;
    try { await send.mutateAsync(); } catch (err) { setErrors({ ...fieldErrors(err), form: errorMessage(err) }); }
  };
  return (
    <Card className="mt-4">
      <h3 className="mb-3 font-semibold">Upload a corrected payment proof</h3>
      {errors.form && <div className="mb-3"><Alert>{errors.form}</Alert></div>}
      <PaymentSection value={v} onChange={setV} errors={errors} amount={app.order?.total} currency={app.order?.currency} />
      <div className="mt-4"><Button onClick={submit} busy={send.isPending}>Submit payment proof</Button></div>
    </Card>
  );
}

function RefundRequest({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const send = useMutation({ mutationFn: () => api(`/orders/${orderId}/refund-request`, { method: 'POST', body: { reason } }) });
  if (send.isSuccess) return <Alert kind="success">Refund request sent. We will email you once it has been reviewed.</Alert>;
  if (!open) return <button className="text-sm text-fg-muted underline" onClick={() => setOpen(true)}>Request a refund</button>;
  return (
    <Card className="mt-2">
      <h3 className="mb-2 font-semibold">Request a refund</h3>
      {send.isError && <div className="mb-2"><Alert>{errorMessage(send.error)}</Alert></div>}
      <Field label="Why are you asking for a refund?">{(p) => <Textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      <div className="mt-3 flex gap-2"><Button onClick={() => send.mutate()} busy={send.isPending} disabled={reason.trim().length < 10}>Send request</Button><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </Card>
  );
}

export default function ApplicationPage() {
  return <Suspense fallback={<Loading />}><ApplicationPageInner /></Suspense>;
}

function ApplicationPageInner() {
  const apps = useApplications();
  const params = useSearchParams();
  const openId = params.get('open');
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (openId && refs.current[openId]) refs.current[openId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [openId, apps.data]);

  if (apps.isLoading) return <Loading />;
  if (apps.isError) return <Alert>Could not load your application.</Alert>;
  if (!apps.data?.length) return <><PageHeader title="Application & Payment" /><PaymentPendingNotice app={null} /></>;

  return (
    <>
      <PageHeader title="Application & Payment" subtitle="Where your enrollment stands and the payment you submitted." />
      <div className="space-y-6">
        {apps.data.map((a) => (
          <Card key={a.id} className={a.id === openId ? 'ring-2 ring-primary' : undefined}>
            <div ref={(el) => { refs.current[a.id] = el; }} />
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div><h2 className="text-lg font-semibold text-fg">{a.batch.name}</h2><p className="text-sm text-fg-muted">Applied {date(a.createdAt)} · starts {date(a.batch.startAt)} · {scheduleText(a.batch)}</p></div>
              <EnrollmentBadge status={a.status} />
            </div>
            <Timeline app={a} />

            {a.status === 'PENDING_PAYMENT' && !a.canResubmit && <Alert kind="info">We received your payment proof and will verify it shortly. You will get a notification and your course opens automatically once it is confirmed.</Alert>}
            {a.status === 'ACTIVE' && <Alert kind="success">Payment verified. You are enrolled — welcome!</Alert>}
            {a.status === 'REJECTED' && <Alert kind="error">This application was not approved{a.payment?.rejectionReason ? `: ${a.payment.rejectionReason}` : '.'}</Alert>}
            {a.canResubmit && <Alert kind="warning">Your payment proof was not accepted{a.payment?.rejectionReason ? `: ${a.payment.rejectionReason}` : '.'} Please upload a corrected one below.</Alert>}

            <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-fg-muted">Teacher</dt><dd className="font-medium">{teacherText(a.batch.mentors)}</dd></div>
              <div><dt className="text-fg-muted">Course fee</dt><dd className="font-medium">{a.order ? money(a.order.total, a.order.currency) : '—'}</dd></div>
              {a.payment && <>
                <div><dt className="text-fg-muted">Payment method</dt><dd className="font-medium">{METHOD_TEXT[a.payment.method] ?? a.payment.method}</dd></div>
                <div><dt className="text-fg-muted">Reference</dt><dd className="font-medium">{a.payment.reference}</dd></div>
                <div><dt className="text-fg-muted">Amount submitted</dt><dd className="font-medium">{money(a.payment.claimedAmount, a.order?.currency)}</dd></div>
                <div><dt className="text-fg-muted">Proof status</dt><dd><Badge status={a.payment.status} /></dd></div>
              </>}
            </dl>

            {a.payment && (
              <div className="mt-4 max-w-sm">
                <h3 className="mb-2 text-sm font-semibold text-fg">Your receipt</h3>
                <ReceiptViewer fileUrl={a.payment.fileUrl} fileMime={a.payment.fileMime} alt="Your payment receipt" />
              </div>
            )}

            {a.canResubmit && <Resubmit app={a} />}
            {a.status === 'ACTIVE' && a.order?.status === 'PAID' && <div className="mt-4"><RefundRequest orderId={a.order.id} /></div>}
          </Card>
        ))}
      </div>
    </>
  );
}
