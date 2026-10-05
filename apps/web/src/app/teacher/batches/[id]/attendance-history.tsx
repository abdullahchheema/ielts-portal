'use client';

import { useQuery } from '@tanstack/react-query';
import { Alert, Empty } from '@/components/ui';
import { date, label } from '@/lib/format';
import { api } from '@/lib/api';


interface Mark { status: string; note: string | null }
interface Change { at: string; actorId: string | null; student: string | null; before: Mark | null; after: Mark | null }

/** Every audited change to a mark in this session. Shown so a changed record is never silent. */
export function AttendanceHistory({ sessionId }: { sessionId: string }) {
  const q = useQuery({ queryKey: ['attendance-history', sessionId], queryFn: () => api<Change[]>(`/mentor/sessions/${sessionId}/attendance/history`) });
  if (q.isLoading) return <p className="text-sm text-fg-muted">Loading history…</p>;
  if (q.isError || !q.data) return <Alert>Could not load the correction history.</Alert>;
  if (q.data.length === 0) return <Empty title="No corrections">Marks changed after they were first recorded will appear here.</Empty>;
  return (
    <ol className="space-y-3 border-l-2 border-border pl-4 text-sm">
      {q.data.map((c, i) => (
        <li key={i}>
          <p className="text-xs text-fg-muted">{date(c.at, true)} · changed by a staff member</p>
          <p className="font-medium text-fg">{c.student ?? 'Student'}</p>
          <p className="text-fg-muted">
            {c.before ? `${label(c.before.status)}` : 'Not marked'} → {c.after ? label(c.after.status) : '—'}
          </p>
          {c.after?.note && <p className="mt-0.5 text-fg-muted">Note: {c.after.note}</p>}
        </li>
      ))}
    </ol>
  );
}
