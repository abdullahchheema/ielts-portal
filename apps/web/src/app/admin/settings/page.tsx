'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { METHOD_LABEL } from '@/components/PaymentSection';
import { Alert, Button, Card, Field, Input, Loading, PageHeader, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface Method { method: string; enabled: boolean; accountTitle: string; accountNumber: string; bankName: string; iban: string; instructions: string }
interface Settings { 'payment.methods': Method[]; 'commerce.refund_window_days': number }

const ORDER = ['BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'OTHER'];

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/admin/settings') });
  const [methods, setMethods] = useState<Method[] | null>(null);
  const [refundDays, setRefundDays] = useState('7');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    const saved = data['payment.methods'];
    // Always show every method so the admin can switch one on; unsaved ones start disabled.
    setMethods(ORDER.map((m) => saved.find((x) => x.method === m) ?? { method: m, enabled: false, accountTitle: '', accountNumber: '', bankName: '', iban: '', instructions: '' }));
    setRefundDays(String(data['commerce.refund_window_days']));
  }, [data]);

  async function save() {
    if (!methods) return;
    setBusy(true); setMsg(null);
    try {
      await api('/admin/settings', { method: 'PUT', body: { 'payment.methods': methods.filter((m) => m.enabled || m.accountNumber || m.accountTitle), 'commerce.refund_window_days': Number(refundDays) } });
      await qc.invalidateQueries({ queryKey: ['settings'] });
      await qc.invalidateQueries({ queryKey: ['payment-methods'] });
      setMsg({ kind: 'success', text: 'Settings saved.' });
    } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }); } finally { setBusy(false); }
  }

  if (isLoading || !methods) return <Loading />;
  const patch = (i: number, p: Partial<Method>) => setMethods(methods.map((m, j) => (j === i ? { ...m, ...p } : m)));

  return (
    <>
      <PageHeader title="Settings" subtitle="Changes are recorded in the audit log." actions={<Button busy={busy} onClick={save}>Save changes</Button>} />
      {msg && <div className="mb-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      <h2 className="mb-1 text-lg font-semibold">Payment methods</h2>
      <p className="mb-4 text-sm text-slate-500">Students see the enabled methods and these account details on the enrollment form.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {methods.map((m, i) => (
          <Card key={m.method} className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{METHOD_LABEL[m.method]}</h3>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={m.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} /> Accept this method</label>
            </div>
            <Field label="Account title">{(p) => <Input {...p} value={m.accountTitle} onChange={(e) => patch(i, { accountTitle: e.target.value })} />}</Field>
            <Field label={m.method === 'BANK_TRANSFER' ? 'Account number' : 'Mobile / account number'}>{(p) => <Input {...p} value={m.accountNumber} onChange={(e) => patch(i, { accountNumber: e.target.value })} />}</Field>
            {m.method === 'BANK_TRANSFER' && <>
              <Field label="Bank name">{(p) => <Input {...p} value={m.bankName} onChange={(e) => patch(i, { bankName: e.target.value })} />}</Field>
              <Field label="IBAN">{(p) => <Input {...p} value={m.iban} onChange={(e) => patch(i, { iban: e.target.value })} />}</Field>
            </>}
            <Field label="Instructions (optional)">{(p) => <Textarea {...p} rows={2} value={m.instructions} onChange={(e) => patch(i, { instructions: e.target.value })} />}</Field>
          </Card>
        ))}
      </div>
      <Card className="mt-6 max-w-md space-y-3">
        <h2 className="font-semibold">Refunds</h2>
        <Field label="Refund request window (days after payment)">{(p) => <Input {...p} type="number" min={0} value={refundDays} onChange={(e) => setRefundDays(e.target.value)} />}</Field>
      </Card>
    </>
  );
}
