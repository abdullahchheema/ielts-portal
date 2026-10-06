'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface Pending { id: string; title: string; trigger: string; questions: { key: 'overall' | 'teacher' | 'course' | 'technical'; label: string }[] }

/** Asks the student one feedback survey at a time. Answers are optional beyond the score, and can be anonymous. */
export function FeedbackPrompt() {
  const qc = useQueryClient();
  const pending = useQuery({ queryKey: ['feedback-pending'], queryFn: () => api<Pending[]>('/me/feedback/pending'), retry: false });
  const [score, setScore] = useState<number | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const current = pending.data?.[0];
  if (!current) return null;

  function reset() { setScore(null); setAnonymous(false); setComments({}); setError(null); }

  async function submit() {
    if (!current || score === null) return;
    setBusy(true); setError(null);
    try {
      await api(`/me/feedback/${current.id}/respond`, { method: 'POST', body: { score, anonymous, comments } });
      reset();
      await qc.invalidateQueries({ queryKey: ['feedback-pending'] });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function dismiss() {
    if (!current) return;
    setBusy(true); setError(null);
    try {
      await api(`/me/feedback/${current.id}/dismiss`, { method: 'POST' });
      reset();
      await qc.invalidateQueries({ queryKey: ['feedback-pending'] });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Card className="mb-6 space-y-4">
      <div>
        <p className="font-medium text-fg">{current.title}</p>
        <p className="text-sm text-fg-muted">On a scale of 0 to 10, how likely are you to recommend the academy to a friend?</p>
      </div>
      {error && <Alert>{error}</Alert>}
      <div role="group" aria-label="Score" className="flex flex-wrap gap-2">
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            type="button"
            aria-label={`Score ${n}`}
            aria-pressed={score === n}
            onClick={() => setScore(n)}
            className={`h-9 w-9 rounded-md text-sm font-medium ring-1 ring-border transition ${score === n ? 'bg-primary text-white' : 'bg-surface text-fg hover:bg-surface-muted'}`}
          >
            {n}
          </button>
        ))}
      </div>
      {score !== null && (
        <div className="space-y-3">
          {current.questions.map((q) => (
            <label key={q.key} className="block text-sm">
              <span className="text-fg">{q.label}</span>
              <Textarea rows={2} maxLength={1000} className="mt-1" value={comments[q.key] ?? ''} onChange={(e) => setComments({ ...comments, [q.key]: e.target.value })} />
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            Send anonymously. The academy will not see that this came from you.
          </label>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={dismiss} busy={busy}>Not now</Button>
        <Button onClick={submit} busy={busy} disabled={score === null}>Send feedback</Button>
      </div>
    </Card>
  );
}
