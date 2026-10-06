'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Empty, Loading, PageHeader } from '@/components/ui';
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
      <ul className="space-y-3">
        {data?.map((r) => (
          <li key={r.id}>
            <Card className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-fg">{r.session.title ?? r.session.topic}</p>
                <p className="text-xs text-fg-muted">
                  {date(r.session.startsAt)}{r.session.mentor ? ` · ${r.session.mentor.displayName}` : ''}{r.durationSec ? ` · ${Math.round(r.durationSec / 60)} min` : ''}
                </p>
                <p className="text-xs text-fg-subtle">
                  {r.progress?.completed ? 'Watched' : r.progress ? `Stopped at ${Math.floor(r.progress.positionSec / 60)} min` : 'Not started'}
                </p>
              </div>
              <Button variant="secondary" onClick={() => play(r.id)}>{r.progress?.completed ? 'Watch again' : 'Watch'}</Button>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
