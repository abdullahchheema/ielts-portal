'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { applicantSchema } from '@ielts/validation';
import { PaymentSection, PaymentValues, METHOD_LABEL, emptyPayment, paymentFormData, validatePayment } from '@/components/PaymentSection';
import { PublicBatch } from '@/components/BatchCard';
import { PublicHeader } from '@/components/PublicHeader';
import { Alert, Button, Card, Field, Input, Loading, Select } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { date, money } from '@/lib/format';

interface PublicCourse { title: string; price: string; currency: string }
interface Details {
  firstName: string; lastName: string; email: string; password: string; phone: string; city: string; country: string;
  currentBand: string; targetBand: string; testType: string; examDate: string;
  ieltsHistory: '' | 'NEVER' | 'TAKEN'; ieltsOverall: string; ieltsListening: string; ieltsReading: string; ieltsWriting: string; ieltsSpeaking: string; ieltsTestDate: string; ieltsAttempts: string;
}
const BANDS = Array.from({ length: 19 }, (_, i) => (i * 0.5).toFixed(1));
const EMPTY: Details = {
  firstName: '', lastName: '', email: '', password: '', phone: '', city: '', country: 'Pakistan', currentBand: '', targetBand: '', testType: '', examDate: '',
  ieltsHistory: '', ieltsOverall: '', ieltsListening: '', ieltsReading: '', ieltsWriting: '', ieltsSpeaking: '', ieltsTestDate: '', ieltsAttempts: '',
};
const DAY: Record<string, string> = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };

function Steps({ step, labels }: { step: number; labels: string[] }) {
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-2 text-sm" aria-label="Enrollment steps">
      {labels.map((l, i) => (
        <li key={l} className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${i < step ? 'bg-green-600 text-white' : i === step ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{i < step ? '✓' : i + 1}</span>
          <span className={i === step ? 'font-semibold text-slate-900' : 'text-slate-500'}>{l}</span>
          {i < labels.length - 1 && <span aria-hidden className="mx-1 h-px w-5 bg-slate-300" />}
        </li>
      ))}
    </ol>
  );
}

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

  const signedIn = !!me.data?.studentId;
  const labels = signedIn ? ['Payment', 'Review'] : ['Your details', 'Payment', 'Review'];
  const at = signedIn ? step + 1 : step; // 0 = details, 1 = payment, 2 = review

  if (batches.isLoading || course.isLoading || me.isLoading) return <><PublicHeader /><Loading /></>;
  const batch = batches.data?.find((b) => b.id === batchId);
  if (!batch || !course.data) {
    return (
      <><PublicHeader /><main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="mb-2 text-2xl font-semibold">This batch is not open for enrollment</h1>
        <p className="mb-6 text-slate-600">It may have closed or been removed. Pick another batch.</p>
        <Link href="/register" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">See open batches</Link>
      </main></>
    );
  }
  const price = course.data.price;
  const payment = pay ?? emptyPayment(price);

  const set = (patch: Partial<Details>) => setD((v) => ({ ...v, ...patch }));
  const text = (k: keyof Details) => ({ value: d[k], onChange: (e: { target: { value: string } }) => set({ [k]: e.target.value } as Partial<Details>) });

  const validateDetails = () => {
    const r = applicantSchema.safeParse(d);
    const e: Record<string, string> = {};
    if (!r.success) for (const i of r.error.issues) e[String(i.path[0])] = i.message;
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const validatePay = () => { const e = validatePayment(payment); setErrors(e); return Object.keys(e).length === 0; };

  const next = () => {
    setFormError(null);
    if (at === 0 && !validateDetails()) return;
    if (at === 1 && !validatePay()) return;
    setErrors({});
    setStep(step + 1);
  };
  const back = () => { setErrors({}); setFormError(null); setStep(Math.max(0, step - 1)); };

  const submit = async () => {
    setBusy(true); setFormError(null);
    try {
      const extra: Record<string, string> = { batchId };
      if (!signedIn) for (const [k, v] of Object.entries(d)) if (v) extra[k] = v;
      await api('/applications', { form: paymentFormData(payment, extra) });
      await qc.invalidateQueries({ queryKey: ['me'] });
      await qc.invalidateQueries({ queryKey: ['applications'] });
      router.replace('/student/application?submitted=1');
    } catch (e) {
      if (e instanceof ApiError && e.details) {
        const fe = e.details;
        setErrors(fe);
        // Send the person back to the step that holds the offending field.
        const detailKeys = Object.keys(EMPTY);
        if (!signedIn && Object.keys(fe).some((k) => detailKeys.includes(k))) setStep(0);
        else if (Object.keys(fe).length) setStep(signedIn ? 0 : 1);
      }
      setFormError(errorMessage(e));
      if (e instanceof ApiError && e.code === 'EMAIL_ALREADY_REGISTERED') setStep(0);
    } finally { setBusy(false); }
  };

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link href="/register" className="text-sm text-indigo-700 hover:underline">← Choose a different batch</Link>
        <h1 className="mb-1 mt-3 text-2xl font-bold text-slate-900">Enroll in {batch.name}</h1>
        <p className="mb-6 text-sm text-slate-600">
          Starts {date(batch.startAt)} · {batch.days.map((x) => DAY[x] ?? x).join(', ') || 'schedule to be announced'}{batch.classTime ? ` at ${batch.classTime}` : ''} · Teacher: {batch.mentorAssigned ? batch.mentors.map((m) => m.name).join(', ') : 'not assigned yet'} · Fee {money(price, course.data.currency)}
        </p>
        <Steps step={step} labels={labels} />

        <Card>
          {formError && <div className="mb-4"><Alert>{formError}{formError.includes('already exists') && <> <Link href={`/login?next=${encodeURIComponent(`/enroll/${batchId}`)}`} className="font-medium underline">Log in to continue</Link></>}</Alert></div>}

          {at === 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Your details</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name" error={errors.firstName}>{(p) => <Input {...p} autoComplete="given-name" {...text('firstName')} />}</Field>
                <Field label="Last name" error={errors.lastName}>{(p) => <Input {...p} autoComplete="family-name" {...text('lastName')} />}</Field>
                <Field label="Email" error={errors.email}>{(p) => <Input {...p} type="email" autoComplete="email" {...text('email')} />}</Field>
                <Field label="Phone / WhatsApp" error={errors.phone}>{(p) => <Input {...p} type="tel" autoComplete="tel" {...text('phone')} />}</Field>
                <Field label="City" error={errors.city}>{(p) => <Input {...p} autoComplete="address-level2" {...text('city')} />}</Field>
                <Field label="Country" error={errors.country}>{(p) => <Input {...p} autoComplete="country-name" {...text('country')} />}</Field>
              </div>
              <Field label="Create a password" hint="At least 10 characters, with a letter and a number. You will use it to log in to your student portal." error={errors.password}>{(p) => <Input {...p} type="password" autoComplete="new-password" {...text('password')} />}</Field>
              <fieldset className="rounded-md bg-slate-50 p-4">
                <legend className="px-1 text-sm font-medium text-slate-700">Your background (optional)</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Current band" error={errors.currentBand}>{(p) => <Select {...p} {...text('currentBand')}><option value="">Not sure</option>{BANDS.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
                  <Field label="Target band" error={errors.targetBand}>{(p) => <Select {...p} {...text('targetBand')}><option value="">Select</option>{BANDS.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
                  <Field label="Test type" error={errors.testType}>{(p) => <Select {...p} {...text('testType')}><option value="">Select</option><option value="ACADEMIC">Academic</option><option value="GENERAL">General Training</option></Select>}</Field>
                  <Field label="Exam date" error={errors.examDate}>{(p) => <Input {...p} type="date" {...text('examDate')} />}</Field>
                </div>
              </fieldset>

              <fieldset className="rounded-md bg-slate-50 p-4">
                <legend className="px-1 text-sm font-medium text-slate-700">Have you taken IELTS before?</legend>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="ieltsHistory" checked={d.ieltsHistory === 'NEVER'} onChange={() => set({ ieltsHistory: 'NEVER', ieltsOverall: '', ieltsListening: '', ieltsReading: '', ieltsWriting: '', ieltsSpeaking: '', ieltsTestDate: '', ieltsAttempts: '' })} /> No, never
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="ieltsHistory" checked={d.ieltsHistory === 'TAKEN'} onChange={() => set({ ieltsHistory: 'TAKEN' })} /> Yes, I have
                  </label>
                </div>
                {errors.ieltsHistory && <p className="mt-1 text-xs text-red-600">{errors.ieltsHistory}</p>}
                {d.ieltsHistory === 'TAKEN' && (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      <Field label="Overall" error={errors.ieltsOverall}>{(p) => <Select {...p} {...text('ieltsOverall')}><option value="">Select</option>{BANDS.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
                      <Field label="Listening">{(p) => <Select {...p} {...text('ieltsListening')}><option value="">—</option>{BANDS.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
                      <Field label="Reading">{(p) => <Select {...p} {...text('ieltsReading')}><option value="">—</option>{BANDS.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
                      <Field label="Writing">{(p) => <Select {...p} {...text('ieltsWriting')}><option value="">—</option>{BANDS.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
                      <Field label="Speaking">{(p) => <Select {...p} {...text('ieltsSpeaking')}><option value="">—</option>{BANDS.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Test date" error={errors.ieltsTestDate}>{(p) => <Input {...p} type="date" {...text('ieltsTestDate')} />}</Field>
                      <Field label="Attempts" error={errors.ieltsAttempts}>{(p) => <Input {...p} type="number" min={1} {...text('ieltsAttempts')} />}</Field>
                    </div>
                  </div>
                )}
              </fieldset>
              <p className="text-sm text-slate-600">Already have an account? <Link href={`/login?next=${encodeURIComponent(`/enroll/${batchId}`)}`} className="font-medium text-indigo-700 underline">Log in</Link></p>
            </div>
          )}

          {at === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Payment</h2>
              <p className="text-sm text-slate-600">Pay the course fee, then upload your receipt. Your place is confirmed once the academy verifies the payment.</p>
              <PaymentSection value={payment} onChange={setPay} errors={errors} amount={price} currency={course.data.currency} />
            </div>
          )}

          {at === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Review and submit</h2>
              <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                {!signedIn ? <>
                  <div><dt className="text-slate-500">Name</dt><dd className="font-medium">{d.firstName} {d.lastName}</dd></div>
                  <div><dt className="text-slate-500">Email</dt><dd className="font-medium">{d.email}</dd></div>
                  <div><dt className="text-slate-500">Phone</dt><dd className="font-medium">{d.phone}</dd></div>
                  <div><dt className="text-slate-500">Location</dt><dd className="font-medium">{d.city}, {d.country}</dd></div>
                </> : <div className="sm:col-span-2"><dt className="text-slate-500">Applying as</dt><dd className="font-medium">{me.data?.email}</dd></div>}
                <div><dt className="text-slate-500">Batch</dt><dd className="font-medium">{batch.name}</dd></div>
                <div><dt className="text-slate-500">Payment method</dt><dd className="font-medium">{METHOD_LABEL[payment.paymentMethod] ?? payment.paymentMethod}</dd></div>
                <div><dt className="text-slate-500">Reference</dt><dd className="font-medium">{payment.transactionReference}</dd></div>
                <div><dt className="text-slate-500">Amount paid</dt><dd className="font-medium">{money(payment.claimedAmount, course.data.currency)}</dd></div>
                <div><dt className="text-slate-500">Receipt</dt><dd className="font-medium">{payment.file?.name}</dd></div>
              </dl>
              <Alert kind="info">After you submit, your application shows as <strong>Pending payment verification</strong>. Course content unlocks once the academy confirms your payment.</Alert>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            {step > 0 ? <Button variant="secondary" onClick={back} disabled={busy}>Back</Button> : <span />}
            {step < labels.length - 1
              ? <Button onClick={next}>Continue</Button>
              : <Button onClick={submit} busy={busy}>Submit application</Button>}
          </div>
        </Card>
      </main>
    </>
  );
}
