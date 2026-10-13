'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Loading, PageHeader, Textarea } from '@/components/ui';
import { AssessmentCard, AssessmentSummary } from '@/components/LessonExtras';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

type AccessStatus = 'ACTIVATED' | 'APPROVED' | 'EXPIRED' | 'PENDING' | 'DECLINED' | 'NONE';
interface Access { canAttempt: boolean; status: AccessStatus; availableFrom: string | null; availableUntil: string | null; instructions: string | null; requestId: string | null; decisionNote: string | null }
interface MockTest extends AssessmentSummary { access: Access }

const STATUS_TONE: Record<AccessStatus, 'green' | 'amber' | 'red' | 'slate'> = {
  ACTIVATED: 'green', APPROVED: 'green', EXPIRED: 'slate', PENDING: 'amber', DECLINED: 'red', NONE: 'slate',
};
const STATUS_LABEL: Record<AccessStatus, string> = {
  ACTIVATED: 'Open for your batch', APPROVED: 'Access approved', EXPIRED: 'Approval window ended',
  PENDING: 'Request pending review', DECLINED: 'Request declined', NONE: 'Not requested yet',
};

function RequestPanel({ test }: { test: MockTest }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request() {
    setBusy(true); setError(null);
    try {
      await api(`/assessments/${test.id}/mock-access-requests`, { method: 'POST', body: { reason: reason.trim() || undefined } });
      await qc.invalidateQueries({ queryKey: ['mock-tests'] });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      {test.access.status === 'DECLINED' && test.access.decisionNote && (
        <Alert kind="info">Your last request was declined: {test.access.decisionNote}</Alert>
      )}
      {test.access.status === 'EXPIRED' && (
        <Alert kind="info">Your approved window {test.access.availableUntil ? `ended ${date(test.access.availableUntil, true)}` : 'has ended'}. Request again to retake it.</Alert>
      )}
      {test.access.status === 'PENDING' ? (
        <p className="text-sm text-slate-500">Your request is waiting for a teacher or admin to review it.</p>
      ) : (
        <>
          <Textarea rows={2} placeholder="Optional note for your reviewer (e.g. which batch/week you're on)" value={reason} onChange={(e) => setReason(e.target.value)} />
          {error && <Alert>{error}</Alert>}
          <Button onClick={request} busy={busy}>Request access</Button>
        </>
      )}
    </div>
  );
}

export default function MockTestsPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['mock-tests'], queryFn: () => api<MockTest[]>('/me/mock-tests') });
  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>Could not load mock tests.</Alert>;

  return (
    <>
      <PageHeader title="Mock Tests" subtitle="Full timed mock tests, unlocked individually by request or opened for your whole batch." />
      {data.length === 0 ? <Empty>No mock tests have been published yet.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((t) => (
            <Card key={t.id} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{t.title}</h3>
                <Badge status={t.access.status} text={STATUS_LABEL[t.access.status]} tone={STATUS_TONE[t.access.status]} />
              </div>
              {t.access.instructions && <p className="text-sm text-slate-600">{t.access.instructions}</p>}
              {t.access.canAttempt ? (
                <AssessmentCard a={t} />
              ) : (
                <RequestPanel test={t} />
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
