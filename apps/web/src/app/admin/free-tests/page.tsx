'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Dialog, Field, Input, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface ConfigRow { id: string; name: string; assessmentId: string; assessmentTitle: string; sequence: number; active: boolean; leadCount: number }
interface LeadRow { id: string; email: string; phone: string; status: string; configName: string; createdAt: string; linked: boolean }

export default function FreeTestsAdminPage() {
  const qc = useQueryClient();
  const { data: configs, isLoading } = useQuery({ queryKey: ['free-test-configs'], queryFn: () => api<ConfigRow[]>('/admin/free-test-configs') });
  const { data: leads } = useQuery({ queryKey: ['free-test-leads'], queryFn: () => api<{ total: number; items: LeadRow[] }>('/admin/free-test-leads') });

  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', assessmentId: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true); setError(null);
    try {
      await api('/admin/free-test-configs', { method: 'POST', body: { name: f.name, assessmentId: f.assessmentId, sequence: configs?.length ?? 0 } });
      await qc.invalidateQueries({ queryKey: ['free-test-configs'] });
      setOpen(false); setF({ name: '', assessmentId: '' });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function toggle(id: string, active: boolean) {
    await api(`/admin/free-test-configs/${id}`, { method: 'PATCH', body: { active: !active } });
    await qc.invalidateQueries({ queryKey: ['free-test-configs'] });
  }

  return (
    <>
      <PageHeader
        title="Free test configuration"
        subtitle="The three fixed free-test configurations that anonymous visitors rotate through, and a view into their conversion funnel."
        actions={<Button onClick={() => setOpen(true)}>Add configuration</Button>}
      />

      <h2 className="mb-2 mt-6 font-semibold">Configurations</h2>
      {isLoading ? <Loading /> : (
        <Table head={['Name', 'Assessment', 'Leads', 'Active']}>
          {(configs ?? []).map((c) => (
            <tr key={c.id}>
              <Td>{c.name}</Td>
              <Td>{c.assessmentTitle}</Td>
              <Td>{c.leadCount}</Td>
              <Td><button onClick={() => toggle(c.id, c.active)}><Badge status={c.active ? 'ACTIVE' : 'INACTIVE'} tone={c.active ? 'green' : 'slate'} /></button></Td>
            </tr>
          ))}
        </Table>
      )}
      {configs?.length === 3 ? null : <p className="mt-2 text-xs text-fg-muted">The spec calls for exactly three rotating configurations; you currently have {configs?.length ?? 0}.</p>}

      <h2 className="mb-2 mt-8 font-semibold">Recent leads</h2>
      <Table head={['Email', 'Phone', 'Config', 'Status', 'Linked to account', 'Claimed']}>
        {(leads?.items ?? []).map((l) => (
          <tr key={l.id}>
            <Td>{l.email}</Td>
            <Td>{l.phone}</Td>
            <Td>{l.configName}</Td>
            <Td><Badge status={l.status} /></Td>
            <Td>{l.linked ? 'Yes' : 'No'}</Td>
            <Td>{new Date(l.createdAt).toLocaleString()}</Td>
          </tr>
        ))}
      </Table>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add a free-test configuration">
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Free Test A" />}</Field>
          <Field label="Assessment ID">{(p) => <Input {...p} value={f.assessmentId} onChange={(e) => setF({ ...f, assessmentId: e.target.value })} placeholder="The published diagnostic assessment's ID" />}</Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} busy={busy} disabled={f.name.trim().length < 2 || !f.assessmentId}>Add</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
