'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Card, CardList, CardListItem, Empty, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface Rec {
  id: string; durationSec: number | null; createdAt: string;
  session: { topic: string; title: string | null; startsAt: string; mentor: { displayName: string } | null };
  progress: { positionSec: number; completed: boolean } | null;
}

/** Class recordings for your batches. Playback links are short-lived. */
export default function RecordingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['recordings'], queryFn: () => api<Rec[]>('/me/recordings') });
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function play(id: string) {
    setError(null);
    try {
      const out = await api<{ url: string }>(`/me/recordings/${id}/play`, { method: 'POST' });
      setPlaying({ id, url: out.url });
    } catch (e) { setError(errorMessage(e)); }
  }

  async function saveProgress(id: string, positionSec: number, completed = false) {
    try {
      await api(`/me/recordings/${id}/progress`, { method: 'POST', body: { positionSec: Math.floor(positionSec), completed } });
      await qc.invalidateQueries({ queryKey: ['recordings'] });
    } catch { /* progress is best-effort; playback keeps working */ }
  }

  return (
    <>
      <PageHeader title="Class recordings" subtitle="Watch the classes you missed or want to revisit. Your place is saved." />
      {error && <Alert>{error}</Alert>}
      {isLoading && <Loading />}
      {isError && <Alert>Could not load recordings.</Alert>}
      {data && data.length === 0 && <Empty title="No recordings yet">Recordings appear here after your teacher uploads them.</Empty>}
      {playing && (
        <Card className="mb-6">
          <video
            key={playing.id}
            controls
            src={playing.url}
            className="w-full rounded-md bg-black"
            onTimeUpdate={(e) => saveProgress(playing.id, e.currentTarget.currentTime)}
            onEnded={(e) => saveProgress(playing.id, e.currentTarget.currentTime, true)}
            onLoadedMetadata={(e) => { const p = data?.find((r) => r.id === playing.id)?.progress?.positionSec ?? 0; if (p > 0 && p < e.currentTarget.duration) e.currentTarget.currentTime = p; }}
          />
        </Card>
      )}
      {data && data.length > 0 && (
        <CardList>
          {data.map((r) => (
            <CardListItem
              key={r.id}
              left={
                <div className="min-w-0">
                  <p className="font-medium text-fg">{r.session.title ?? r.session.topic}</p>
                  <p className="text-xs text-fg-muted">
                    {date(r.session.startsAt)}{r.session.mentor ? ` · ${r.session.mentor.displayName}` : ''}{r.durationSec ? ` · ${Math.round(r.durationSec / 60)} min` : ''}
                  </p>
                  <div className="mt-1">
                    {r.progress?.completed
                      ? <Badge status="COMPLETED" tone="green" text="Watched" />
                      : r.progress
                        ? <Badge status="IN_PROGRESS" tone="amber" text={`Stopped at ${Math.floor(r.progress.positionSec / 60)} min`} />
                        : <Badge status="NOT_STARTED" tone="slate" text="Not started" />}
                  </div>
                </div>
              }
              right={<Button variant="secondary" onClick={() => play(r.id)}>{r.progress?.completed ? 'Watch again' : 'Watch'}</Button>}
            />
          ))}
        </CardList>
      )}
    </>
  );
}
