'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Field, Input, Section, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { can, useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { date, label } from '@/lib/format';

const STAGES = [
  'REGISTERED', 'APPLICATION_STARTED', 'APPLICATION_SUBMITTED', 'PAYMENT_PENDING', 'PAYMENT_APPROVED',
  'ENROLLED', 'ACTIVE', 'AT_RISK', 'INACTIVE', 'COMPLETED', 'ALUMNI',
] as const;

interface Timeline {
  stage: string | null;
  since: string | null;
  transitions: { id: string; fromStage: string | null; toStage: string; reason: string; source: string; createdAt: string }[];
}

const SOURCE_LABEL: Record<string, string> = { SYSTEM: 'Automatic', STAFF: 'Staff', BACKFILL: 'Recorded at go-live' };

/** Where a student is in their journey, why they moved, and (for staff with lifecycle.manage) a checked manual move. */
export function LifecyclePanel({ studentId }: { studentId: string }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['lifecycle', studentId], queryFn: () => api<Timeline>(`/admin/students/${studentId}/lifecycle`) });
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function move() {
    setError(null); setBusy(true);
    try {
      await api(`/admin/students/${studentId}/lifecycle`, { method: 'POST', body: { to, reason } });
      setTo(''); setReason('');
      await qc.invalidateQueries({ queryKey: ['lifecycle', studentId] });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  const options = STAGES.filter((s) => s !== q.data?.stage);

  return (
    <Section title="Lifecycle" description="Each change is recorded with its reason. Automatic changes follow enrolment, activity and completion.">
      <Card className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {q.isError && <Alert>Could not load the lifecycle.</Alert>}
        {q.data && (
          <>
            <p className="text-sm text-fg-muted">
              Current stage: <span className="font-medium text-fg">{q.data.stage ? label(q.data.stage) : 'Not yet recorded'}</span>
              {q.data.since && <> · since {date(q.data.since)}</>}
            </p>
            {q.data.transitions.length > 0 && (
              <ol className="space-y-2 border-l border-border pl-4">
                {q.data.transitions.map((t) => (
                  <li key={t.id} className="text-sm">
                    <p className="text-fg">
                      {t.fromStage ? `${label(t.fromStage)} → ` : ''}{label(t.toStage)}
                      <span className="ml-2 text-xs text-fg-subtle">{date(t.createdAt)} · {SOURCE_LABEL[t.source] ?? label(t.source)}</span>
                    </p>
                    <p className="text-fg-muted">{t.reason}</p>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
        {can(me, 'lifecycle.manage') && q.data && (
          <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[minmax(0,14rem)_1fr_auto] sm:items-end">
            <Field label="Move to">
              {(p) => (
                <Select {...p} value={to} onChange={(e) => setTo(e.target.value)}>
                  <option value="">Choose a stage</option>
                  {options.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Reason" hint="Recorded with the change. Three to 300 characters.">
              {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}
            </Field>
            <Button onClick={move} busy={busy} disabled={!to || reason.trim().length < 3}>Record change</Button>
          </div>
        )}
      </Card>
    </Section>
  );
}
