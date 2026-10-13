'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Dialog, DropdownMenu, Empty, Field, Input, Loading, PageHeader, Section, Table, Td, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';
import { roleLabel } from '@/lib/roles';

interface Staff { id: string; email: string; status: string; lastLoginAt: string | null; mfaEnabled: boolean; roles: string[]; isOwner: boolean }
interface Role { id: string; name: string; description: string | null; users: number; permissions: string[] }
const ASSIGNABLE = ['SUPER_ADMIN', 'ACADEMIC_ADMIN', 'CONTENT_MANAGER', 'FINANCE_ADMIN', 'SUPPORT_AGENT', 'MARKETING', 'MENTOR'];

function RolePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="grid grid-cols-2 gap-2">
      <legend className="sr-only">Roles</legend>
      {ASSIGNABLE.map((r) => (
        <Checkbox key={r} checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} label={roleLabel(r)} />
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
  const me = useMe();
  const confirm = useConfirm();
  const refresh = () => qc.invalidateQueries({ queryKey: ['staff'] });

  async function act(fn: () => Promise<unknown>, close: () => void) {
    setBusy(true); setError(null);
    try { await fn(); await refresh(); close(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  /** Only the owner can remove a Super Admin, and nobody can remove the owner or themselves. The API enforces the same rules. */
  const canRemove = (s: Staff) => !!me.data && me.data.id !== s.id && !s.isOwner && (me.data.isOwner || !s.roles.includes('SUPER_ADMIN'));

  async function remove(s: Staff) {
    const ok = await confirm({
      title: 'Remove this account?',
      message: `${s.email} will be signed out, lose all staff roles and will not be able to log in. Their records and the audit history are kept.`,
      tone: 'danger', confirmLabel: 'Remove account',
    });
    if (!ok) return;
    setError(null);
    try { await api(`/admin/users/${s.id}/remove`, { method: 'POST' }); await refresh(); } catch (e) { setError(errorMessage(e)); }
  }

  return (
    <>
      <PageHeader title="Staff & roles" subtitle="Role changes sign the person out everywhere and are audited." actions={<Button onClick={() => { setPicked([]); setEmail(''); setError(null); setInvite(true); }}>Invite staff</Button>} />
      {error && !invite && !edit && <div className="mb-4"><Alert>{error}</Alert></div>}
      <Section title="Staff accounts">
        {staff.isLoading && <Loading />}
        {staff.isError && <Alert>Could not load staff.</Alert>}
        {staff.data && (staff.data.length === 0 ? <Empty title="No staff yet">Invite your first staff member to get started.</Empty> : (
          <Table head={['Email', 'Roles', '2FA', 'Last login', 'Status', '']} sticky>
            {staff.data.map((s) => (
              <tr key={s.id}>
                <Td className="font-medium">{s.email}{s.isOwner && <span className="ml-2 text-xs text-fg-muted">Owner</span>}</Td>
                <Td>{s.roles.filter((r) => ASSIGNABLE.includes(r)).map((r) => roleLabel(r)).join(', ')}</Td>
                <Td>{s.mfaEnabled ? <Badge status="ACTIVE" tone="green" /> : <Badge status="PENDING" tone="amber" />}</Td>
                <Td>{date(s.lastLoginAt, true)}</Td><Td><Badge status={s.status} /></Td>
                <Td>
                  <DropdownMenu
                    align="end"
                    trigger={<Button variant="ghost" size="xs">Actions</Button>}
                    items={[
                      { key: 'edit', label: 'Edit roles', onSelect: () => { setPicked(s.roles.filter((r) => ASSIGNABLE.includes(r))); setError(null); setEdit(s); } },
                      ...(canRemove(s) ? [{ key: 'remove', label: 'Remove', danger: true, onSelect: () => remove(s) }] : []),
                    ]}
                  />
                </Td>
              </tr>
            ))}
          </Table>
        ))}
      </Section>

      {roles.data && (
        <Section title="What each role can do" className="mt-8">
          <div className="grid gap-4 md:grid-cols-2">
            {roles.data.filter((r) => ASSIGNABLE.includes(r.name)).map((r) => (
              <Card key={r.id}>
                <div className="mb-1 flex items-center justify-between"><h3 className="font-medium">{roleLabel(r.name)}</h3><span className="text-xs text-fg-muted">{r.users} user{r.users === 1 ? '' : 's'}</span></div>
                <p className="mb-2 text-sm text-fg-muted">{r.description}</p>
                <p className="flex flex-wrap gap-1">{r.permissions.map((p) => <code key={p} className="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-fg">{p}</code>)}</p>
              </Card>
            ))}
          </div>
        </Section>
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
