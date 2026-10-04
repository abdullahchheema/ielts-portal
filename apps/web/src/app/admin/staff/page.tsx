'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Field, Input, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';
import { roleLabel } from '@/lib/roles';

interface Staff { id: string; email: string; status: string; lastLoginAt: string | null; mfaEnabled: boolean; roles: string[] }
interface Role { id: string; name: string; description: string | null; users: number; permissions: string[] }
const ASSIGNABLE = ['SUPER_ADMIN', 'ACADEMIC_ADMIN', 'CONTENT_MANAGER', 'FINANCE_ADMIN', 'SUPPORT_AGENT', 'MARKETING', 'MENTOR'];

function RolePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="grid grid-cols-2 gap-2">
      <legend className="sr-only">Roles</legend>
      {ASSIGNABLE.map((r) => (
        <label key={r} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} /> {roleLabel(r)}
        </label>
      ))}
    </fieldset>
  );
}

export default function StaffPage() {
  const qc = useQueryClient();
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api<Staff[]>('/admin/staff') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/admin/roles') });
  const [invite, setInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [edit, setEdit] = useState<Staff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['staff'] });

  async function act(fn: () => Promise<unknown>, close: () => void) {
    setBusy(true); setError(null);
    try { await fn(); await refresh(); close(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Staff & roles" subtitle="Role changes sign the person out everywhere and are audited." actions={<Button onClick={() => { setPicked([]); setEmail(''); setError(null); setInvite(true); }}>Invite staff</Button>} />
      {staff.isLoading && <Loading />}
      {staff.isError && <Alert>Could not load staff.</Alert>}
      {staff.data && (
        <Table head={['Email', 'Roles', '2FA', 'Last login', 'Status', '']}>
          {staff.data.map((s) => (
            <tr key={s.id}>
              <Td className="font-medium">{s.email}</Td>
              <Td>{s.roles.filter((r) => ASSIGNABLE.includes(r)).map((r) => roleLabel(r)).join(', ')}</Td>
              <Td>{s.mfaEnabled ? <Badge status="ACTIVE" tone="green" /> : <Badge status="PENDING" tone="amber" />}</Td>
              <Td>{date(s.lastLoginAt, true)}</Td><Td><Badge status={s.status} /></Td>
              <Td><Button variant="ghost" className="!py-1" onClick={() => { setPicked(s.roles.filter((r) => ASSIGNABLE.includes(r))); setError(null); setEdit(s); }}>Edit roles</Button></Td>
            </tr>
          ))}
        </Table>
      )}

      {roles.data && (
        <div className="mt-8">
          <h2 className="mb-3 font-semibold">What each role can do</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {roles.data.filter((r) => ASSIGNABLE.includes(r.name)).map((r) => (
              <Card key={r.id}>
                <div className="mb-1 flex items-center justify-between"><h3 className="font-medium">{roleLabel(r.name)}</h3><span className="text-xs text-fg-muted">{r.users} user{r.users === 1 ? '' : 's'}</span></div>
                <p className="mb-2 text-sm text-fg-muted">{r.description}</p>
                <p className="flex flex-wrap gap-1">{r.permissions.map((p) => <code key={p} className="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-fg">{p}</code>)}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Dialog open={invite} onClose={() => setInvite(false)} title="Invite staff member">
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Email" hint="They get a link to set a password and must enable 2FA at first sign-in.">{(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <RolePicker value={picked} onChange={setPicked} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setInvite(false)}>Cancel</Button>
            <Button busy={busy} disabled={!email || picked.length === 0} onClick={() => act(() => api('/admin/staff', { method: 'POST', body: { email, roles: picked } }), () => setInvite(false))}>Send invite</Button></div>
        </div>
      </Dialog>
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={`Roles — ${edit?.email ?? ''}`}>
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <RolePicker value={picked} onChange={setPicked} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
            <Button busy={busy} onClick={() => edit && act(() => api(`/admin/users/${edit.id}/roles`, { method: 'PUT', body: { roles: picked } }), () => setEdit(null))}>Save roles</Button></div>
        </div>
      </Dialog>
    </>
  );
}
