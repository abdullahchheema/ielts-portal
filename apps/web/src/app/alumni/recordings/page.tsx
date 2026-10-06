'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Empty, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface Home {
  recordings: { id: string; durationSec: number | null; createdAt: string; session: { topic: string; title: string | null; startsAt: string }; progress: { positionSec: number; completed: boolean } | null }[];
}

/** Revision library: class recordings the academy has opened to alumni. Playback links are short-lived. */
export default function AlumniRecordingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['alumni-home'], queryFn: () => api<Home>('/alumni/home'), retry: false });
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function play(id: string) {
    setActionError(null);
    try {
      const out = await api<{ url: string }>(`/me/recordings/${id}/play`, { method: 'POST' });
      setPlaying({ id, url: out.url });
    } catch (e) { setActionError(errorMessage(e)); }
  }

  async function saveProgress(id: string, positionSec: number, completed = false) {
    try {
      await api(`/me/recordings/${id}/progress`, { method: 'POST', body: { positionSec: Math.floor(positionSec), completed } });
      await qc.invalidateQueries({ queryKey: ['alumni-home'] });
    } catch { /* progress is best-effort; playback keeps working */ }
  }

  return (
    <>
      <PageHeader title="Revision library" subtitle="Classes the academy has shared with alumni. Your place is saved." />
      {(actionError || isError) && <Alert>{actionError ?? errorMessage(error)}</Alert>}
      {isLoading && <Loading />}
      {data && data.recordings.length === 0 && <Empty title="Nothing in the library yet">Recordings appear here when the academy shares them.</Empty>}
      {playing && (
        <Card className="mb-6">
          <video
            key={playing.id}
            controls
            src={playing.url}
            className="w-full rounded-md bg-black"
            onTimeUpdate={(e) => saveProgress(playing.id, e.currentTarget.currentTime)}
            onEnded={(e) => saveProgress(playing.id, e.currentTarget.currentTime, true)}
            onLoadedMetadata={(e) => { const p = data?.recordings.find((r) => r.id === playing.id)?.progress?.positionSec ?? 0; if (p > 0 && p < e.currentTarget.duration) e.currentTarget.currentTime = p; }}
          />
        </Card>
      )}
      <ul className="space-y-3">
        {data?.recordings.map((r) => (
          <li key={r.id}>
            <Card className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-fg">{r.session.title ?? r.session.topic}</p>
                <p className="text-xs text-fg-muted">{date(r.session.startsAt)}{r.durationSec ? ` · ${Math.round(r.durationSec / 60)} min` : ''}</p>
                <p className="text-xs text-fg-subtle">{r.progress?.completed ? 'Watched' : r.progress ? `Stopped at ${Math.floor(r.progress.positionSec / 60)} min` : 'Not started'}</p>
              </div>
              <Button variant="secondary" onClick={() => play(r.id)}>{r.progress?.completed ? 'Watch again' : 'Watch'}</Button>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
