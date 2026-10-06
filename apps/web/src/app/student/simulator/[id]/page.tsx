'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Loading, PageHeader, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface Exam {
  id: string; status: string; stage: 'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING' | 'DONE'; stageRevision: number; includeSpeaking: boolean;
  stageDeadlineAt: string | null; secondsRemaining: number | null; overallEstimate: string | null; missingSkills: string[];
  sections: {
    listening: { attemptId: string; status: string; band: string | null } | null;
    reading: { attemptId: string; status: string; band: string | null } | null;
    writing: { responseId: string; status: string; wordCount: number } | null;
    speaking: { attemptId: string; status: string; answers: number } | null;
  };
}

const ORDER = ['LISTENING', 'READING', 'WRITING', 'SPEAKING', 'DONE'] as const;

/** Stage-by-stage view. Each stage offers one clear next action; the server decides whether it is allowed. */
export default function SimulatorStagePage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['sim-exam', id],
    queryFn: () => api<Exam>(`/simulator/exams/${id}`),
    refetchInterval: 15_000,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  // Count the timed section down on screen; the server still decides when it has ended.
  useEffect(() => { setRemaining(data?.secondsRemaining ?? null); }, [data?.secondsRemaining, data?.stageRevision]);
  useEffect(() => {
    if (remaining === null || remaining <= 0) return;
    const t = setInterval(() => setRemaining((r) => (r === null ? null : Math.max(0, r - 1))), 1000);
    return () => clearInterval(t);
  }, [remaining]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['sim-exam', id] });

  async function advance() {
    if (!data) return;
    setBusy(true); setError(null);
    try {
      await api(`/simulator/exams/${id}/advance`, { method: 'POST', body: { expectedRevision: data.stageRevision } });
      await refresh();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function submitSection(attemptId: string) {
    setBusy(true); setError(null);
    try {
      await api(`/attempts/${attemptId}/submit`, { method: 'POST' });
      await advance();
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  }

  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>Could not load this simulator.</Alert>;

  const currentIndex = ORDER.indexOf(data.stage);
  const done = data.status === 'COMPLETED';

  return (
    <>
      <PageHeader
        title="Full IELTS simulator"
        subtitle={done ? 'Finished. Scores below are estimates.' : `Stage: ${data.stage.toLowerCase()}`}
        actions={<div className="flex items-center gap-3">
          {remaining !== null && !done && <span className="font-mono text-lg tabular-nums text-fg">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span>}
          <Badge status={data.status} />
        </div>}
      />
      {error && <Alert>{error}</Alert>}

      <ol className="mb-6 flex flex-wrap gap-2 text-sm">
        {ORDER.filter((s) => s !== 'SPEAKING' || data.includeSpeaking).map((s, i) => (
          <li key={s} className={`rounded-full px-3 py-1 ${i < currentIndex || done ? 'bg-success-soft text-success' : s === data.stage ? 'bg-primary-soft text-primary' : 'bg-surface-muted text-fg-subtle'}`}>
            {s === 'DONE' ? 'Results' : s[0] + s.slice(1).toLowerCase()}
          </li>
        ))}
      </ol>

      {data.stage === 'LISTENING' || data.stage === 'READING' ? (
        <Card className="max-w-2xl space-y-4">
          <p className="text-fg">Work through the {data.stage.toLowerCase()} section. When you finish, or when the timer runs out, submit it to move on.</p>
          {(() => {
            const sec = data.stage === 'LISTENING' ? data.sections.listening : data.sections.reading;
            return sec ? (
              <div className="flex flex-wrap gap-3">
                {sec.status === 'IN_PROGRESS' && <Link href={`/student/attempts/${sec.attemptId}`} className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover">Open the {data.stage.toLowerCase()} section</Link>}
                <Button variant="secondary" onClick={() => submitSection(sec.attemptId)} busy={busy}>Submit section and continue</Button>
              </div>
            ) : null;
          })()}
        </Card>
      ) : null}

      {data.stage === 'WRITING' && data.sections.writing && (
        <WritingStage responseId={data.sections.writing.responseId} status={data.sections.writing.status} onAdvance={advance} busy={busy} />
      )}

      {data.stage === 'SPEAKING' && (
        <Card className="max-w-2xl space-y-4">
          <p className="text-fg">Record your speaking answers in the speaking practice area. When you have answered, continue to finish the simulator.</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/student/speaking-ai" className="inline-flex h-10 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-muted">Open speaking practice</Link>
            <Button onClick={advance} busy={busy}>Finish simulator</Button>
          </div>
        </Card>
      )}

      {done && (
        <Card className="max-w-2xl space-y-3">
          <h2 className="font-semibold text-fg">Estimated overall band</h2>
          {data.overallEstimate ? (
            <p className="font-display text-3xl font-semibold text-fg">{data.overallEstimate}</p>
          ) : (
            <p className="text-sm text-fg-muted">No overall estimate was produced because some sections could not be assessed.</p>
          )}
          {data.missingSkills.length > 0 && <p className="text-sm text-fg-muted">Not assessed: {data.missingSkills.map((s) => s.toLowerCase()).join(', ')}.</p>}
          <p className="text-xs text-fg-subtle">Estimated overall band. This is a practice estimate, not an official IELTS result.</p>
        </Card>
      )}
    </>
  );
}

function WritingStage({ responseId, status, onAdvance, busy: parentBusy }: { responseId: string; status: string; onAdvance: () => void; busy: boolean }) {
  const { data, refetch } = useQuery({ queryKey: ['sim-essay', responseId], queryFn: () => api<{ body: string; revision: number; promptText: string; status: string }>(`/writing/responses/${responseId}`) });
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data && text === null) setText(data.body); }, [data, text]);
  if (!data || text === null) return <Loading />;
  const editable = data.status === 'DRAFT';

  async function save() {
    setBusy(true); setError(null);
    try { await api(`/writing/responses/${responseId}`, { method: 'PUT', body: { revision: data!.revision, body: text } }); await refetch(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true); setError(null);
    try {
      await save();
      await api(`/writing/responses/${responseId}/submit`, { method: 'POST' });
      await refetch();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Card className="max-w-3xl space-y-4">
      <p className="font-medium text-fg">{data.promptText}</p>
      {error && <Alert>{error}</Alert>}
      <Textarea aria-label="Essay" rows={16} value={text} readOnly={!editable} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap justify-between gap-3">
        <span className="text-sm text-fg-muted">{countWords(text)} words</span>
        {editable
          ? <Button onClick={submit} busy={busy || parentBusy}>Submit essay and continue</Button>
          : <Button onClick={onAdvance} busy={parentBusy}>Continue</Button>}
      </div>
      {status === 'EVALUATED' && <p className="text-sm text-fg-muted">Your essay is marked and kept with its AI estimate.</p>}
    </Card>
  );
}

const countWords = (t: string) => (t.match(/[A-Za-z’'-]+/g) ?? []).length;
