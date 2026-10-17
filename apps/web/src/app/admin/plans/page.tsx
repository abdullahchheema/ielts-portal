'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Dialog, Field, Input, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { money } from '@/lib/format';

interface Entitlement { id: string; featureKey: string; value: boolean; description: string | null }
interface PlanRow { id: string; name: string; displayName: string; description: string | null; price: string; currency: string; active: boolean; sortOrder: number; entitlements: Entitlement[] }

export default function AdminPlansPage() {
  const qc = useQueryClient();
  const { data: plans, isLoading } = useQuery({ queryKey: ['admin-plans'], queryFn: () => api<PlanRow[]>('/admin/plans') });
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openEdit(p: PlanRow) { setEditing(p); setPrice(p.price); setError(null); }

  async function savePrice() {
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      await api(`/admin/plans/${editing.id}`, { method: 'PATCH', body: { price: Number(price) } });
      await qc.invalidateQueries({ queryKey: ['admin-plans'] });
      setEditing(null);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function toggleActive(p: PlanRow) {
    await api(`/admin/plans/${p.id}`, { method: 'PATCH', body: { active: !p.active } });
    await qc.invalidateQueries({ queryKey: ['admin-plans'] });
  }

  async function toggleFeature(p: PlanRow, e: Entitlement) {
    const next = p.entitlements.map((x) => (x.featureKey === e.featureKey ? { featureKey: x.featureKey, value: !x.value, description: x.description } : { featureKey: x.featureKey, value: x.value, description: x.description }));
    await api(`/admin/plans/${p.id}/entitlements`, { method: 'PUT', body: { entitlements: next } });
    await qc.invalidateQueries({ queryKey: ['admin-plans'] });
  }

  if (isLoading) return <Loading />;

  return (
    <>
      <PageHeader title="Plans" subtitle="The four commercial tiers and their feature entitlements. Changes take effect immediately." />
      {(plans ?? []).sort((a, b) => a.sortOrder - b.sortOrder).map((p) => (
        <div key={p.id} className="mb-6 rounded-lg border border-border bg-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">{p.displayName} <span className="ml-2 text-sm text-fg-muted">({p.name})</span></h2>
              <p className="text-sm text-fg-muted">{p.description}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold">{money(p.price, p.currency)}</span>
              <Button variant="secondary" onClick={() => openEdit(p)}>Edit price</Button>
              <button onClick={() => toggleActive(p)}><Badge status={p.active ? 'ACTIVE' : 'INACTIVE'} tone={p.active ? 'green' : 'slate'} /></button>
            </div>
          </div>
          <Table head={['Feature', 'Enabled']}>
            {p.entitlements.map((e) => (
              <tr key={e.featureKey}>
                <Td>{e.featureKey}{e.description ? <span className="ml-2 text-xs text-fg-muted">{e.description}</span> : null}</Td>
                <Td><button onClick={() => toggleFeature(p, e)}><Badge status={e.value ? 'YES' : 'NO'} tone={e.value ? 'green' : 'slate'} /></button></Td>
              </tr>
            ))}
          </Table>
        </div>
      ))}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={`Edit ${editing?.displayName ?? ''} price`}>
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <Field label="Price">{(p) => <Input {...p} type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />}</Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={savePrice} busy={busy}>Save</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
