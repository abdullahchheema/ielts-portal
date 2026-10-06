'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Dialog, Empty, Field, Input, Loading, PageHeader, Select, Table, Td, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface Row {
  studentId: string; status: string; lastActivityAt: string | null; lastActivityLabel: string | null; reasons: string[]; computedAt: string;
  student: { firstName: string; lastName: string };
}

const STATUSES = ['', 'AT_RISK', 'INACTIVE', 'REACTIVATED'];

/** Students whose engagement has dropped, with the reasons and a way to assign follow-up. */
export default function EngagementPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const { data, isLoading, isError } = useQuery({ queryKey: ['engagement', status], queryFn: () => api<Row[]>(`/admin/engagement?take=100${status ? `&status=${status}` : ''}`) });
  const [target, setTarget] = useState<Row | null>(null);
  const [assignee, setAssignee] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function assign() {
    if (!target) return;
    setBusy(true); setError(null);
    try {
      await api(`/admin/students/${target.studentId}/follow-ups`, { method: 'POST', body: { assigneeId: assignee, note } });
      setTarget(null); setNote('');
      await qc.invalidateQueries({ queryKey: ['engagement'] });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Engagement" subtitle="Students who have gone quiet, and why. Assign a follow-up so someone takes it on." />
      <div className="mb-4">
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">At risk, inactive and returned</option>
          {STATUSES.slice(1).map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
        </Select>
      </div>
      {error && <Alert>{error}</Alert>}
      {isLoading && <Loading />}
      {isError && <Alert>Could not load engagement.</Alert>}
      {data && (data.length === 0 ? <Empty title="Nobody needs follow-up">Engagement is healthy for now.</Empty> : (
        <Table head={['Student', 'Status', 'Last activity', 'Reasons', '']}>
          {data.map((r) => (
            <tr key={r.studentId}>
              <Td><Link href={`/admin/students/${r.studentId}`} className="font-medium text-primary hover:underline">{r.student.firstName} {r.student.lastName}</Link></Td>
              <Td><Badge status={r.status} /></Td>
              <Td>{r.lastActivityLabel ?? '—'}<span className="block text-xs text-fg-subtle">{date(r.lastActivityAt)}</span></Td>
              <Td className="max-w-md text-sm text-fg-muted">{r.reasons.join(' ')}</Td>
              <Td><Button variant="secondary" className="!py-1" onClick={() => setTarget(r)}>Assign follow-up</Button></Td>
            </tr>
          ))}
        </Table>
      ))}

      <Dialog open={!!target} onClose={() => setTarget(null)} title="Assign follow-up">
        <div className="space-y-3">
          <Field label="Assignee (staff user ID)">{(p) => <Input {...p} value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Paste the staff member's user ID" />}</Field>
          <Field label="What should happen">{(p) => <Textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTarget(null)}>Cancel</Button>
            <Button onClick={assign} busy={busy} disabled={note.trim().length < 3 || assignee.length < 30}>Assign</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
