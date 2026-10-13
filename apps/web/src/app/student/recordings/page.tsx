'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Card, Empty, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface Recording {
  id: string; title: string; module: string | null; description: string | null; driveUrl: string; publishedAt: string | null; opened: boolean;
  batch: { name: string }; session: { topic: string; startsAt: string } | null;
}

export default function RecordingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['recordings'], queryFn: () => api<Recording[]>('/me/recordings') });

  async function open(r: Recording) {
    window.open(r.driveUrl, '_blank', 'noopener,noreferrer');
    try { await api(`/me/recordings/${r.id}/open`, { method: 'POST' }); qc.invalidateQueries({ queryKey: ['recordings'] }); } catch { /* best-effort marker, never blocks opening the recording */ }
  }

  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>{errorMessage(error)}</Alert>;

  return (
    <>
      <PageHeader title="Class Recordings" subtitle="Previously recorded classes your teacher has published, for the batches you are enrolled in." />
      {!data.length ? <Empty>No recordings have been published yet. Your Class Schedule will also link to a recording once one is available for a past class.</Empty> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.map((r) => (
            <Card key={r.id}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-slate-900">{r.title}</h3>
                {r.opened && <Badge status="OPENED" tone="green" text="Reviewed" />}
              </div>
              <p className="mt-1 text-xs text-slate-500">{r.batch.name}{r.session ? ` · ${r.session.topic} · ${date(r.session.startsAt)}` : ''}</p>
              {r.description && <p className="mt-2 text-sm text-slate-700">{r.description}</p>}
              <button onClick={() => open(r)} className="mt-3 inline-block text-sm font-medium text-indigo-700 hover:underline">Open recording ↗</button>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
