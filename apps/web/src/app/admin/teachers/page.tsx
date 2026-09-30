'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Dialog, Empty, Field, Input, Loading, PageHeader, Table, Td, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface Mentor { id: string; displayName: string; status: string; specializations: string[]; user: { email: string }; _count: { batches: number } }

export default function TeachersPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-mentors'], queryFn: () => api<Mentor[]>('/admin/mentors') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ email: '', displayName: '', bio: '', specializations: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true); setError(null);
    try {
      await api('/admin/mentors', { method: 'POST', body: { email: f.email, displayName: f.displayName, bio: f.bio || undefined, specializations: f.specializations.split(',').map((s) => s.trim()).filter(Boolean) } });
      await qc.invalidateQueries({ queryKey: ['admin-mentors'] });
      setOpen(false); setF({ email: '', displayName: '', bio: '', specializations: '' });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Teachers" subtitle="Teachers only see the batches they are assigned to." actions={<Button onClick={() => setOpen(true)}>Add teacher</Button>} />
      {isLoading && <Loading />}
      {isError && <Alert>Could not load teachers.</Alert>}
      {data && (data.length === 0 ? <Empty>No teachers yet.</Empty> : (
        <Table head={['Name', 'Email', 'Specializations', 'Batches', 'Status']}>
          {data.map((m) => (
            <tr key={m.id}><Td className="font-medium">{m.displayName}</Td><Td>{m.user.email}</Td><Td>{m.specializations.join(', ') || '—'}</Td><Td>{m._count.batches}</Td><Td><Badge status={m.status} /></Td></tr>
          ))}
        </Table>
      ))}
      <Dialog open={open} onClose={() => setOpen(false)} title="Add teacher">
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <Field label="Display name">{(p) => <Input {...p} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />}</Field>
          <Field label="Email" hint="They will receive a link to set their password.">{(p) => <Input {...p} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <Field label="Specializations" hint="Comma separated, e.g. Writing, Speaking">{(p) => <Input {...p} value={f.specializations} onChange={(e) => setF({ ...f, specializations: e.target.value })} />}</Field>
          <Field label="Bio (optional)">{(p) => <Textarea {...p} rows={3} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} />}</Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button busy={busy} disabled={!f.email || f.displayName.trim().length < 2} onClick={create}>Create & invite</Button></div>
        </div>
      </Dialog>
    </>
  );
}
