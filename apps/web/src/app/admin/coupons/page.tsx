'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Dialog, Empty, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface Coupon {
  id: string; code: string; discountType: 'PERCENTAGE' | 'FIXED'; value: string; active: boolean; redeemedCount: number;
  maxRedemptions: number | null; perUserLimit: number; expiresAt: string | null; firstPurchaseOnly: boolean;
}

export default function CouponsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-coupons'], queryFn: () => api<Coupon[]>('/admin/coupons') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: '', discountType: 'PERCENTAGE', value: '', maxRedemptions: '', perUserLimit: '1', expiresAt: '', firstPurchaseOnly: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-coupons'] });

  async function create() {
    setBusy(true); setError(null);
    try {
      await api('/admin/coupons', { method: 'POST', body: {
        code: f.code, discountType: f.discountType, value: Number(f.value), perUserLimit: Number(f.perUserLimit), firstPurchaseOnly: f.firstPurchaseOnly,
        maxRedemptions: f.maxRedemptions ? Number(f.maxRedemptions) : undefined, expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : undefined,
      } });
      await refresh(); setOpen(false); setF({ code: '', discountType: 'PERCENTAGE', value: '', maxRedemptions: '', perUserLimit: '1', expiresAt: '', firstPurchaseOnly: false });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function toggle(c: Coupon) {
    try { await api(`/admin/coupons/${c.id}`, { method: 'PATCH', body: { active: !c.active } }); refresh(); } catch (e) { setError(errorMessage(e)); }
  }

  return (
    <>
      <PageHeader title="Coupons" actions={<Button onClick={() => setOpen(true)}>New coupon</Button>} />
      {isLoading && <Loading />}
      {isError && <Alert>Could not load coupons.</Alert>}
      {data && (data.length === 0 ? <Empty>No coupons yet.</Empty> : (
        <Table head={['Code', 'Discount', 'Used', 'Per user', 'Expires', 'Status', '']}>
          {data.map((c) => (
            <tr key={c.id}>
              <Td className="font-mono font-medium">{c.code}{c.firstPurchaseOnly && <span className="block font-sans text-xs font-normal text-fg-muted">First purchase only</span>}</Td>
              <Td>{c.discountType === 'PERCENTAGE' ? `${Number(c.value)}%` : `PKR ${Number(c.value).toLocaleString()}`}</Td>
              <Td>{c.redeemedCount}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''}</Td>
              <Td>{c.perUserLimit}</Td><Td>{date(c.expiresAt)}</Td>
              <Td><Badge status={c.active ? 'ACTIVE' : 'DRAFT'} tone={c.active ? 'green' : 'slate'} /></Td>
              <Td><Button variant="ghost" className="!py-1" onClick={() => toggle(c)}>{c.active ? 'Disable' : 'Enable'}</Button></Td>
            </tr>
          ))}
        </Table>
      ))}
      <Dialog open={open} onClose={() => setOpen(false)} title="New coupon">
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <Field label="Code">{(p) => <Input {...p} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">{(p) => <Select {...p} value={f.discountType} onChange={(e) => setF({ ...f, discountType: e.target.value })}><option value="PERCENTAGE">Percentage</option><option value="FIXED">Fixed amount</option></Select>}</Field>
            <Field label={f.discountType === 'PERCENTAGE' ? 'Percent off' : 'Amount off (PKR)'}>{(p) => <Input {...p} type="number" min={1} max={f.discountType === 'PERCENTAGE' ? 100 : undefined} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />}</Field>
            <Field label="Max redemptions" hint="Blank = unlimited">{(p) => <Input {...p} type="number" min={1} value={f.maxRedemptions} onChange={(e) => setF({ ...f, maxRedemptions: e.target.value })} />}</Field>
            <Field label="Per student">{(p) => <Input {...p} type="number" min={1} value={f.perUserLimit} onChange={(e) => setF({ ...f, perUserLimit: e.target.value })} />}</Field>
          </div>
          <Field label="Expires">{(p) => <Input {...p} type="datetime-local" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />}</Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.firstPurchaseOnly} onChange={(e) => setF({ ...f, firstPurchaseOnly: e.target.checked })} /> First purchase only</label>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button busy={busy} disabled={f.code.length < 3 || !f.value} onClick={create}>Create</Button></div>
        </div>
      </Dialog>
    </>
  );
}
