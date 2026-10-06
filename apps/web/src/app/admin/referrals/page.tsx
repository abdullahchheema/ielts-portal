'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Dialog, Empty, Field, Input, Loading, PageHeader, Select, Table, Td, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface Row {
  id: string; status: string; code: string; rewardType: string | null; rewardAmount: string | null; createdAt: string;
  enrolledAt: string | null; qualifiedAt: string | null; rewardedAt: string | null; rejectedReason: string | null;
  referrer: { id: string; firstName: string; lastName: string };
  referredStudent: { id: string; firstName: string; lastName: string } | null;
}

const STATUSES = ['REGISTERED', 'APPLIED', 'ENROLLED', 'QUALIFIED', 'REWARDED', 'REJECTED'];

export default function AdminReferralsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [status, setStatus] = useState('QUALIFIED');
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-referrals', status],
    queryFn: () => api<{ total: number; items: Row[] }>(`/admin/referrals?status=${status}&take=100`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-referrals'] });

  async function reward(r: Row) {
    if (!(await confirm({ message: `Give ${r.referrer.firstName}’s referral reward now?`, confirmLabel: 'Reward' }))) return;
    try {
      const out = await api<{ rewarded: boolean; reason?: string }>(`/admin/referrals/${r.id}/reward`, { method: 'POST' });
      if (!out.rewarded) setError(out.reason ?? 'The reward was not given.');
      await refresh();
    } catch (e) { setError(errorMessage(e)); }
  }
  async function reject() {
    if (!rejecting) return;
    try {
      await api(`/admin/referrals/${rejecting.id}/reject`, { method: 'POST', body: { reason } });
      setRejecting(null); setReason(''); await refresh();
    } catch (e) { setError(errorMessage(e)); }
  }

  return (
    <>
      <PageHeader title="Referrals" subtitle="Qualified referrals wait here for a reward decision. Each reward is recorded once." />
      <div className="mb-4">
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
        </Select>
      </div>
      {error && <Alert>{error}</Alert>}
      {isLoading && <Loading />}
      {isError && <Alert>Could not load referrals.</Alert>}
      {data && (data.items.length === 0 ? <Empty title={`No ${status.toLowerCase()} referrals`}>Nothing to review right now.</Empty> : (
        <Table head={['Referrer', 'Referred student', 'Code', 'Status', 'Updated', 'Reward', '']}>
          {data.items.map((r) => (
            <tr key={r.id}>
              <Td>{r.referrer.firstName} {r.referrer.lastName}</Td>
              <Td>{r.referredStudent ? `${r.referredStudent.firstName} ${r.referredStudent.lastName}` : '—'}</Td>
              <Td className="font-mono">{r.code}</Td>
              <Td><Badge status={r.status} />{r.rejectedReason && <span className="block text-xs text-fg-muted">{r.rejectedReason}</span>}</Td>
              <Td>{date(r.rewardedAt ?? r.qualifiedAt ?? r.enrolledAt ?? r.createdAt)}</Td>
              <Td>{r.rewardType ? `${r.rewardType.replace('_', ' ').toLowerCase()} ${r.rewardAmount ?? ''}` : '—'}</Td>
              <Td>
                <div className="flex gap-2">
                  {r.status === 'QUALIFIED' && <Button variant="secondary" className="!py-1" onClick={() => reward(r)}>Reward</Button>}
                  {r.status !== 'REWARDED' && r.status !== 'REJECTED' && <Button variant="ghost" className="!py-1" onClick={() => setRejecting(r)}>Reject</Button>}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      ))}

      <Dialog open={!!rejecting} onClose={() => setRejecting(null)} title="Reject referral">
        <div className="space-y-3">
          <Field label="Reason (shown in the audit log)">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="danger" onClick={reject} disabled={reason.trim().length < 3}>Reject referral</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
