'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Alert, Card, Field, Input, Loading, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { money } from '@/lib/format';

export interface PaymentMethodInfo {
  method: string; enabled: boolean; accountTitle: string; accountNumber: string; bankName?: string; iban?: string; instructions?: string;
}

export interface PaymentValues {
  paymentMethod: string; transactionReference: string; claimedAmount: string; transferDate: string; senderName: string; file: File | null;
}

export const emptyPayment = (amount: string | number = ''): PaymentValues => ({
  paymentMethod: '', transactionReference: '', claimedAmount: String(amount), transferDate: new Date().toISOString().slice(0, 10), senderName: '', file: null,
});

export const METHOD_LABEL: Record<string, string> = { BANK_TRANSFER: 'Bank transfer', JAZZCASH: 'JazzCash', EASYPAISA: 'Easypaisa', OTHER: 'Other' };
export const MAX_PROOF_MB = 5;

/** Client-side checks so people get an instant message; the API re-validates everything. */
export function validatePayment(v: PaymentValues): Record<string, string> {
  const e: Record<string, string> = {};
  if (!v.paymentMethod) e.paymentMethod = 'Choose how you paid.';
  if (v.transactionReference.trim().length < 4) e.transactionReference = 'Enter the reference number from your receipt.';
  if (!(Number(v.claimedAmount) > 0)) e.claimedAmount = 'Enter the amount you paid.';
  if (!v.transferDate) e.transferDate = 'Enter the payment date.';
  if (!v.file) e.file = 'Attach a screenshot or PDF of your receipt.';
  else if (v.file.size > MAX_PROOF_MB * 1024 * 1024) e.file = `The file must be under ${MAX_PROOF_MB} MB.`;
  else if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(v.file.type)) e.file = 'Only JPG, PNG, WebP or PDF files are accepted.';
  return e;
}

export function paymentFormData(v: PaymentValues, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.append('paymentMethod', v.paymentMethod);
  fd.append('transactionReference', v.transactionReference.trim());
  fd.append('claimedAmount', v.claimedAmount);
  fd.append('transferDate', v.transferDate);
  if (v.senderName.trim()) fd.append('senderName', v.senderName.trim());
  for (const [k, val] of Object.entries(extra)) fd.append(k, val);
  if (v.file) fd.append('file', v.file);
  return fd;
}

/** Payment method picker, the account to pay into, and the proof fields. Used by the enrollment form and by resubmissions. */
export function PaymentSection({ value, onChange, errors, amount, currency = 'PKR' }: {
  value: PaymentValues; onChange: (v: PaymentValues) => void; errors: Record<string, string>; amount?: string | number; currency?: string;
}) {
  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: () => api<PaymentMethodInfo[]>('/public/payment-methods') });
  const set = (patch: Partial<PaymentValues>) => onChange({ ...value, ...patch });
  const chosen = methods.data?.find((m) => m.method === value.paymentMethod);

  useEffect(() => {
    if (!value.paymentMethod && methods.data?.length === 1) onChange({ ...value, paymentMethod: methods.data[0].method });
  }, [methods.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (methods.isLoading) return <Loading />;
  if (methods.isError || !methods.data?.length) return <Alert>Payments are not set up yet. Please contact the academy.</Alert>;

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">How did you pay?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {methods.data.map((m) => (
            <label key={m.method} className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2.5 text-sm ring-1 ring-inset ${value.paymentMethod === m.method ? 'bg-indigo-50 ring-2 ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-slate-50'}`}>
              <input type="radio" name="paymentMethod" value={m.method} checked={value.paymentMethod === m.method} onChange={() => set({ paymentMethod: m.method })} className="accent-indigo-600" />
              {METHOD_LABEL[m.method] ?? m.method}
            </label>
          ))}
        </div>
        {errors.paymentMethod && <p role="alert" className="mt-1 text-xs text-red-600">{errors.paymentMethod}</p>}
      </fieldset>

      {chosen && (
        <Card className="bg-slate-50">
          <p className="text-sm font-medium text-slate-900">Send {amount !== undefined ? <strong>{money(amount, currency)}</strong> : 'the course fee'} to:</p>
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Account title</dt><dd className="font-medium">{chosen.accountTitle || '—'}</dd></div>
            <div><dt className="text-slate-500">{chosen.method === 'BANK_TRANSFER' ? 'Account number' : 'Mobile number'}</dt><dd className="font-medium">{chosen.accountNumber || '—'}</dd></div>
            {chosen.bankName && <div><dt className="text-slate-500">Bank</dt><dd className="font-medium">{chosen.bankName}</dd></div>}
            {chosen.iban && <div><dt className="text-slate-500">IBAN</dt><dd className="font-medium">{chosen.iban}</dd></div>}
          </dl>
          {chosen.instructions && <p className="mt-2 text-xs text-slate-600">{chosen.instructions}</p>}
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Transaction / reference number" error={errors.transactionReference}>{(p) => <Input {...p} value={value.transactionReference} onChange={(e) => set({ transactionReference: e.target.value })} />}</Field>
        <Field label={`Amount paid (${currency})`} error={errors.claimedAmount}>{(p) => <Input {...p} type="number" inputMode="decimal" min={0} value={value.claimedAmount} onChange={(e) => set({ claimedAmount: e.target.value })} />}</Field>
        <Field label="Payment date" error={errors.transferDate}>{(p) => <Input {...p} type="date" max={new Date().toISOString().slice(0, 10)} value={value.transferDate} onChange={(e) => set({ transferDate: e.target.value })} />}</Field>
        <Field label="Name on the payment (optional)" error={errors.senderName}>{(p) => <Input {...p} value={value.senderName} onChange={(e) => set({ senderName: e.target.value })} />}</Field>
      </div>

      <Field label="Payment screenshot or receipt" hint={`JPG, PNG, WebP or PDF, up to ${MAX_PROOF_MB} MB.`} error={errors.file}>
        {(p) => <input {...p} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => set({ file: e.target.files?.[0] ?? null })} className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100" />}
      </Field>
    </div>
  );
}
