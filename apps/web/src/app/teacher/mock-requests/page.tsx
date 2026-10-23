'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Empty, Loading, PageHeader, Table, Td, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface Req {
  id: string; status: string; reason: string | null; batchId: string | null; decisionNote: string | null; createdAt: string;
  assessmentId: string | null; mockExamId: string | null;
  assessment: { title: string; timeLimitMin: number | null } | null; mockExam: { title: string } | null;
  student: { firstName: string; lastName: string };
}

function DeclineBox({ onDecline, busy }: { onDecline: (note: string) => void; busy: boolean }) {
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>Decline</Button>;
  return (
    <div className="flex flex-col gap-2">
      <Textarea rows={2} placeholder="Why? (shown to the student)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2"><Button variant="secondary" busy={busy} onClick={() => onDecline(note)}>Confirm decline</Button><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button></div>
    </div>
  );
}

export default function MockRequestsPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const requests = useQuery({ queryKey: ['mock-requests'], queryFn: () => api<Req[]>('/mentor/mock-access-requests') });
  const pending = requests.data?.filter((r) => r.status === 'PENDING') ?? [];
  const decided = requests.data?.filter((r) => r.status !== 'PENDING') ?? [];

  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id); setError(null);
    try { await action(); await qc.invalidateQueries({ queryKey: ['mock-requests'] }); }
    catch (e) { setError(errorMessage(e)); } finally { setBusyId(null); }
  }
  const approve = (id: string) => run(id, () => api(`/mentor/mock-access-requests/${id}/approve`, { method: 'POST', body: {} }));
  const decline = (id: string, note: string) => run(id, () => api(`/mentor/mock-access-requests/${id}/decline`, { method: 'POST', body: { decisionNote: note || undefined } }));
  const openForBatch = (r: Req) => run(r.id, async () => {
    const url = r.mockExamId ? `/mentor/mock-exams/${r.mockExamId}/mock-activations` : `/mentor/assessments/${r.assessmentId}/mock-activations`;
    await api(url, { method: 'POST', body: { batchId: r.batchId, availableFrom: new Date().toISOString() } });
    await api(`/mentor/mock-access-requests/${r.id}/approve`, { method: 'POST', body: {} });
  });
  const titleOf = (r: Req) => r.assessment?.title ?? r.mockExam?.title ?? '—';

  return (
    <>
      <PageHeader title="Mock test access" subtitle="Approve individual students, or open a mock test for everyone in a batch at once." />
      {error && <Alert>{error}</Alert>}
      {requests.isLoading && <Loading />}
      {requests.isError && <Alert>Could not load requests.</Alert>}
      {requests.data && (
        <div className="space-y-8">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Pending ({pending.length})</h2>
            {pending.length === 0 ? <Empty>No requests are waiting on you.</Empty> : (
              <Table head={['Student', 'Mock test', 'Reason', 'Requested', 'Actions']}>
                {pending.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">{r.student.firstName} {r.student.lastName}</Td>
                    <Td>{titleOf(r)}</Td>
                    <Td className="max-w-[16rem] truncate">{r.reason ?? '—'}</Td>
                    <Td>{date(r.createdAt, true)}</Td>
                    <Td>
                      <div className="flex flex-col items-start gap-2">
                        <div className="flex flex-wrap gap-2">
                          <Button busy={busyId === r.id} onClick={() => approve(r.id)}>Approve this student</Button>
                          {r.batchId && <Button variant="secondary" busy={busyId === r.id} onClick={() => openForBatch(r)}>Open for whole batch</Button>}
                        </div>
                        <DeclineBox busy={busyId === r.id} onDecline={(note) => decline(r.id, note)} />
                      </div>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Recently decided</h2>
            {decided.length === 0 ? <Empty>Nothing decided yet.</Empty> : (
              <Table head={['Student', 'Mock test', 'Decision', 'Note']}>
                {decided.slice(0, 20).map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">{r.student.firstName} {r.student.lastName}</Td>
                    <Td>{titleOf(r)}</Td>
                    <Td><Badge status={r.status} /></Td>
                    <Td className="max-w-[20rem] truncate">{r.decisionNote ?? '—'}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
        </div>
      )}
    </>
  );
}
