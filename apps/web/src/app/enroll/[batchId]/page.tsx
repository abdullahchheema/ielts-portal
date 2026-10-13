'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { COUNTRIES, PAKISTAN_CITIES, applicantProfileSchema } from '@ielts/validation';
import { AccountGate } from '@/components/AccountGate';
import { PaymentSection, PaymentValues, METHOD_LABEL, emptyPayment, paymentFormData, validatePayment } from '@/components/PaymentSection';
import { Answers, SurveyWizard, SurveyComplete } from '@/components/survey/SurveyWizard';
import { PublicBatch } from '@/components/BatchCard';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';
import { Alert, Button, Card, DefinitionList, Field, Input, Loading, Section, Select, Stepper } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { date, money } from '@/lib/format';

interface PublicCourse { title: string; price: string; currency: string }
interface Details {
  phone: string; city: string; country: string; testType: string; targetBand: string; examDate: string;
  ieltsHistory: '' | 'NEVER' | 'TAKEN'; ieltsOverall: string;
}
const EMPTY: Details = { phone: '', city: '', country: 'Pakistan', testType: '', targetBand: '', examDate: '', ieltsHistory: '', ieltsOverall: '' };
const DAY: Record<string, string> = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };
const LABELS = ['Your goals', 'Payment', 'Review & submit'];
const STEP_DEFS = LABELS.map((label, i) => ({ key: String(i), label }));
const TEST_LABEL: Record<string, string> = { ACADEMIC: 'Academic', GENERAL: 'General Training' };

export default function EnrollPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const batches = useQuery({ queryKey: ['public-batches'], queryFn: () => api<PublicBatch[]>('/public/batches') });
  const course = useQuery({ queryKey: ['public-course'], queryFn: () => api<PublicCourse>('/public/course') });

  const [step, setStep] = useState(0);
  const [d, setD] = useState<Details>(EMPTY);
  const [pay, setPay] = useState<PaymentValues | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Anonymous visitors take the survey before they have an account; their answers live here until
  // the authenticated SurveyWizard picks them up and submits them for real.
  const draftKey = `survey:${batchId}`;
  const [anonSurveyDone, setAnonSurveyDone] = useState(false);
  const [localDraft, setLocalDraft] = useState<Answers | undefined>(undefined);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) setLocalDraft(JSON.parse(raw));
    } catch { /* storage may be blocked */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  if (batches.isLoading || course.isLoading || me.isLoading) return <><PublicHeader /><Loading /></>;
  const batch = batches.data?.find((b) => b.id === batchId);
  if (!batch || !course.data) {
    return (
      <>
        <PublicHeader />
        <main className="mx-auto max-w-xl px-5 py-20 text-center sm:px-8">
          <h1 className="mb-2 text-h2 font-extrabold text-fg">This batch is not open for enrollment</h1>
          <p className="mb-7 text-fg-muted">It may have closed or been removed. Pick another batch.</p>
          <Link href="/register" className="inline-flex items-center justify-center rounded-xl bg-primary px-6 py-3.5 text-sm font-bold text-white shadow-sm hover:bg-primary-hover">See open batches</Link>
        </main>
        <PublicFooter />
      </>
    );
  }

  const header = (
    <>
      <Link href="/register" className="text-sm font-semibold text-primary hover:underline">← Choose a different batch</Link>
      <h1 className="mb-2 mt-4 text-h2 font-extrabold text-fg">Enroll in {batch.name}</h1>
      <p className="mb-7 text-base text-fg-muted">
        Starts {date(batch.startAt)} · {batch.days.map((x) => DAY[x] ?? x).join(', ') || 'schedule to be announced'}{batch.classTime ? ` at ${batch.classTime}` : ''} · Teacher: {batch.mentorAssigned ? batch.mentors.map((m) => m.name).join(', ') : 'not assigned yet'}
      </p>
    </>
  );

  const set = (patch: Partial<Details>) => setD((v) => ({ ...v, ...patch }));

  const onSurveyComplete = (mapped: SurveyComplete) => {
    set({ targetBand: mapped.targetBand, ieltsHistory: mapped.ieltsHistory, ieltsOverall: mapped.ieltsOverall });
    try { localStorage.removeItem(draftKey); } catch { /* storage may be blocked */ }
    setStep(1);
  };

  if (step === 0) {
    return (
      <>
        <PublicHeader />
        <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
          {header}
          <div className="mb-7"><Stepper steps={STEP_DEFS} activeIndex={step} /></div>
          <Card>
            {!me.data ? (
              anonSurveyDone ? (
                <AccountGate
                  next={`/enroll/${batchId}`}
                  title="Create your account to continue"
                  intro="Nice — we've saved your answers. Create your account and we'll pick up right where you left off, no need to answer again."
                />
              ) : (
                <SurveyWizard persist="local" storageKey={draftKey} onComplete={() => setAnonSurveyDone(true)} />
              )
            ) : me.data.studentId ? (
              <SurveyWizard persist="auth" localSeed={localDraft} onComplete={onSurveyComplete} />
            ) : (
              <Alert kind="info">You are signed in with a staff or teacher account. Log in with a student account to apply for a batch.</Alert>
            )}
          </Card>
        </main>
        <PublicFooter />
      </>
    );
  }

  // Past step 0, an account (and student role) is required — this is a defensive guard for the rare
  // case a session expires mid-flow, not the normal path (step only ever advances once authenticated).
  if (!me.data || !me.data.studentId) {
    return (
      <>
        <PublicHeader />
        <main className="mx-auto max-w-xl px-5 py-20 text-center sm:px-8">
          <Alert kind="info">Your session changed. Please start again from the beginning.</Alert>
          <Link href={`/enroll/${batchId}`} className="mt-5 inline-flex items-center justify-center rounded-xl bg-primary px-6 py-3.5 text-sm font-bold text-white shadow-sm hover:bg-primary-hover">Start over</Link>
        </main>
        <PublicFooter />
      </>
    );
  }

  const price = course.data.price;
  const payment = pay ?? emptyPayment(price);

  const text = (k: keyof Details) => ({ value: d[k], onChange: (e: { target: { value: string } }) => set({ [k]: e.target.value } as Partial<Details>) });

  const validateDetails = () => {
    const r = applicantProfileSchema.safeParse(d);
    const e: Record<string, string> = {};
    if (!r.success) for (const i of r.error.issues) e[String(i.path[0])] ??= i.message;
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const validatePay = () => { const e = validatePayment(payment); setErrors(e); return Object.keys(e).length === 0; };

  const next = () => {
    setFormError(null);
    if (step === 1 && !validatePay()) return;
    setErrors({});
    setStep(step + 1);
  };
  const back = () => { setErrors({}); setFormError(null); setStep(Math.max(0, step - 1)); };

  const submit = async () => {
    setFormError(null);
    if (!validateDetails()) return;
    setBusy(true);
    try {
      const extra: Record<string, string> = { batchId };
      for (const [k, v] of Object.entries(d)) if (v) extra[k] = v;
      await api('/applications', { form: paymentFormData(payment, extra) });
      await qc.invalidateQueries({ queryKey: ['me'] });
      await qc.invalidateQueries({ queryKey: ['applications'] });
      router.replace('/student/application?submitted=1');
    } catch (e) {
      if (e instanceof ApiError && e.details) {
        const fe = e.details;
        setErrors(fe);
        const profileKeys = Object.keys(EMPTY);
        if (Object.keys(fe).some((k) => profileKeys.includes(k))) setStep(2);
        else if (Object.keys(fe).length) setStep(1);
      }
      setFormError(errorMessage(e));
    } finally { setBusy(false); }
  };

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        {header}
        <div className="mb-7"><Stepper steps={STEP_DEFS} activeIndex={step} /></div>

        <Card>
          {formError && <div className="mb-4"><Alert>{formError}</Alert></div>}

          {step === 1 && (
            <Section title="Payment" description="Pay the course fee, then upload your receipt. Your place is confirmed once the academy verifies the payment.">
              <PaymentSection value={payment} onChange={setPay} errors={errors} amount={price} currency={course.data.currency} batchId={batchId} />
            </Section>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <Section title="A few more details">
                <p className="mb-4 text-sm text-fg-muted">Applying as <span className="font-medium text-fg">{me.data.email}</span>. Every field is required.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Phone / WhatsApp" error={errors.phone}>{(p) => <Input {...p} type="tel" autoComplete="tel" {...text('phone')} />}</Field>
                  <Field label="City" error={errors.city}>{(p) => <Select {...p} {...text('city')}><option value="">Select</option>{PAKISTAN_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>}</Field>
                  <Field label="Country" error={errors.country}>{(p) => <Select {...p} {...text('country')}>{COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>}</Field>
                  <Field label="Test you are preparing for" error={errors.testType}>{(p) => <Select {...p} {...text('testType')}><option value="">Select</option><option value="ACADEMIC">Academic</option><option value="GENERAL">General Training</option></Select>}</Field>
                  <Field label="Planned exam date" error={errors.examDate}>{(p) => <Input {...p} type="date" {...text('examDate')} />}</Field>
                </div>
              </Section>

              <Section title="Review and submit">
                <DefinitionList
                  items={[
                    { label: 'Applying as', value: me.data.email },
                    { label: 'Test', value: TEST_LABEL[d.testType] ?? d.testType },
                    { label: 'Target band', value: d.targetBand },
                    { label: 'Previous IELTS', value: d.ieltsHistory === 'TAKEN' ? `Yes, overall ${d.ieltsOverall}` : 'No, first time' },
                    { label: 'Batch', value: batch.name },
                    { label: 'Payment method', value: METHOD_LABEL[payment.paymentMethod] ?? payment.paymentMethod },
                    { label: 'Reference', value: payment.transactionReference },
                    { label: 'Amount paid', value: money(payment.claimedAmount, course.data.currency) },
                    { label: 'Receipt', value: payment.file?.name },
                  ]}
                />
                <div className="mt-4"><Alert kind="info">After you submit, your application shows as <strong>Pending payment verification</strong>. Course content unlocks once the academy confirms your payment.</Alert></div>
              </Section>
            </div>
          )}

          {step > 0 && (
            <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
              <Button variant="secondary" onClick={back} disabled={busy}>Back</Button>
              {step < LABELS.length - 1
                ? <Button onClick={next}>Continue</Button>
                : <Button onClick={submit} busy={busy}>Submit application</Button>}
            </div>
          )}
        </Card>
      </main>
      <PublicFooter />
    </>
  );
}
