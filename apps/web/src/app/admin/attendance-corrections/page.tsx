'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Empty, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface Row {
  id: string; status: string; fromStatus: string | null; toStatus: string; reason: string; createdAt: string; decisionNote: string | null;
  session: { id: string; topic: string; startsAt: string };
  student: { id: string; firstName: string; lastName: string };
}

/** Attendance corrections teachers have asked for, after the edit window. Every decision is audited. */
export default function AttendanceCorrectionsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('PENDING');
  const { data, isLoading, isError } = useQuery({ queryKey: ['attendance-corrections', status], queryFn: () => api<Row[]>(`/admin/attendance-corrections?status=${status}`) });
  const [error, setError] = useState<string | null>(null);

  async function decide(r: Row, approve: boolean) {
    setError(null);
    try {
      await api(`/admin/attendance-corrections/${r.id}/decide`, { method: 'POST', body: { approve } });
      await qc.invalidateQueries({ queryKey: ['attendance-corrections'] });
    } catch (e) { setError(errorMessage(e)); }
  }

  return (
    <>
      <PageHeader title="Attendance corrections" subtitle="Changes requested to attendance that is past its edit window." />
      <div className="mb-4">
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="PENDING">Waiting for a decision</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </Select>
      </div>
      {error && <Alert>{error}</Alert>}
      {isLoading && <Loading />}
      {isError && <Alert>Could not load corrections.</Alert>}
      {data && (data.length === 0 ? <Empty title="Nothing here" /> : (
        <Table head={['Student', 'Class', 'Change', 'Reason', 'Status', '']}>
          {data.map((r) => (
            <tr key={r.id}>
              <Td>{r.student.firstName} {r.student.lastName}</Td>
              <Td>{r.session.topic}<span className="block text-xs text-fg-subtle">{date(r.session.startsAt)}</span></Td>
              <Td>{r.fromStatus ?? 'none'} → {r.toStatus}</Td>
              <Td className="max-w-sm text-sm text-fg-muted">{r.reason}</Td>
              <Td><Badge status={r.status} />{r.decisionNote && <span className="block text-xs text-fg-muted">{r.decisionNote}</span>}</Td>
              <Td>
                {r.status === 'PENDING' && (
                  <div className="flex gap-2">
                    <Button className="!py-1" onClick={() => decide(r, true)}>Approve</Button>
                    <Button variant="ghost" className="!py-1" onClick={() => decide(r, false)}>Reject</Button>
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      ))}
    </>
  );
}
