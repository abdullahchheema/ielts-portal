'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, CardList, CardListItem, Empty, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface Recording {
  id: string; title: string; module: string | null; description: string | null; driveUrl: string; publishedAt: string | null; opened: boolean;
  batch: { name: string }; session: { topic: string; startsAt: string } | null;
}

/** Lecture recordings your teacher has shared (Google Drive links), for the batches you are enrolled in. */
export default function RecordingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['recordings'], queryFn: () => api<Recording[]>('/me/recordings') });

  async function open(r: Recording) {
    window.open(r.driveUrl, '_blank', 'noopener,noreferrer');
    try { await api(`/me/recordings/${r.id}/open`, { method: 'POST' }); qc.invalidateQueries({ queryKey: ['recordings'] }); } catch { /* best-effort marker, never blocks opening the recording */ }
  }

  return (
    <>
      <PageHeader title="Class recordings" subtitle="Previously recorded classes your teacher has published, for the batches you are enrolled in." />
      {isLoading && <Loading />}
      {isError && <Alert>{errorMessage(error)}</Alert>}
      {data && data.length === 0 && <Empty title="No recordings yet">Your Class Schedule will also link to a recording once one is available for a past class.</Empty>}
      {data && data.length > 0 && (
        <CardList>
          {data.map((r) => (
            <CardListItem
              key={r.id}
              left={
                <div className="min-w-0">
                  <p className="font-medium text-fg">{r.title}</p>
                  <p className="text-xs text-fg-muted">{r.batch.name}{r.session ? ` · ${r.session.topic} · ${date(r.session.startsAt)}` : ''}</p>
                  {r.description && <p className="mt-1 text-sm text-fg-muted">{r.description}</p>}
                  {r.opened && <div className="mt-1"><Badge status="OPENED" tone="green" text="Reviewed" /></div>}
                </div>
              }
              right={<a href={r.driveUrl} onClick={() => open(r)} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline">Open recording ↗</a>}
            />
          ))}
        </CardList>
      )}
    </>
  );
}
