'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AIInsightCard, AiUnavailable, Alert, Button, Card, Empty, Field, Loading, PageHeader, ScoreBreakdown, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { extensionFor, useRecorder } from '@/lib/use-recorder';

type Part = 'PART1' | 'PART2' | 'PART3';
interface Question { id: string; part: Part; prompt: string }
interface Attempt { id: string; mode: string; status: string }
interface Answer {
  id: string; part: Part; promptText: string; status: string; transcriptStatus: string; transcript: string | null; durationSec: string | null;
  lastError: string | null; latestEvaluation: { estimatedBand: string; criteria: { key: string; score: number | null; comment: string }[]; feedback: { strengths: string[]; weaknesses: string[]; corrections: { original: string; corrected: string }[]; recommendedPractice: string[]; pronunciationNote: string } } | null;
}

const CRITERIA: Record<string, string> = { FLUENCY: 'Fluency and coherence', LEXICAL: 'Lexical resource', GRAMMAR: 'Grammatical range and accuracy', PRONUNCIATION: 'Pronunciation' };
const PART_LABEL: Record<Part, string> = { PART1: 'Part 1 · everyday questions', PART2: 'Part 2 · long turn (about 2 minutes)', PART3: 'Part 3 · discussion' };
const MAX_SECONDS: Record<Part, number> = { PART1: 60, PART2: 150, PART3: 90 };

/** Speaking practice: pick a part, answer a question out loud, and get a transcript with an AI estimate. */
export default function SpeakingPracticePage() {
  const [part, setPart] = useState<Part>('PART1');
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const questions = useQuery({ queryKey: ['speaking-questions', part], queryFn: () => api<Question[]>(`/speaking/questions?part=${part}`) });
  const rec = useRecorder({ maxSeconds: MAX_SECONDS[part] });

  async function begin() {
    setError(null); setBusy(true);
    try {
      const a = await api<Attempt>('/speaking/attempts', { method: 'POST', body: { mode: part } });
      setAttempt(a);
      await nextQuestion(a.id);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function nextQuestion(attemptId: string) {
    const pool = questions.data ?? [];
    const q = pool.length ? pool[Math.floor(Math.random() * pool.length)] : { id: '', part, prompt: 'Describe something you do to relax.' };
    setQuestion(q);
    setAnswer(null);
    rec.reset();
    const r = await api<{ id: string; part: Part; promptText: string; status: string }>(`/speaking/attempts/${attemptId}/responses`, {
      method: 'POST', body: { part, ...(q.id ? { questionId: q.id } : { promptText: q.prompt }) },
    });
    setAnswer({ id: r.id, part: r.part, promptText: r.promptText, status: r.status, transcriptStatus: 'PENDING', transcript: null, durationSec: null, lastError: null, latestEvaluation: null });
  }

  async function upload() {
    if (!answer || rec.state.kind !== 'ready') return;
    const blob = rec.state.blob;
    if (blob.size > 25 * 1024 * 1024) { setError('The recording is larger than 25 MB.'); return; }
    setBusy(true); setError(null);
    try {
      const p = await api<{ mode: 'direct' | 'multipart'; url?: string; headers?: Record<string, string> }>(`/speaking/responses/${answer.id}/presign`, {
        method: 'POST', body: { mime: blob.type || 'audio/webm', sizeBytes: blob.size },
      });
      if (p.mode === 'multipart') {
        const fd = new FormData();
        fd.append('file', blob, `answer.${extensionFor(blob.type)}`);
        await api(`/speaking/responses/${answer.id}/audio`, { method: 'POST', form: fd });
      } else {
        const put = await fetch(p.url!, { method: 'PUT', headers: p.headers, body: blob });
        if (!put.ok) throw new Error('The upload did not complete. Please try again.');
        await api(`/speaking/responses/${answer.id}/complete`, { method: 'POST', body: { durationSec: rec.elapsed } });
      }
      setAnswer({ ...answer, status: 'UPLOADED' });
      poll(answer.id);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  /** Re-reads the answer until the transcript and estimate are ready, or a failure is recorded. */
  async function poll(id: string) {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const r = await api<Answer>(`/speaking/responses/${id}`);
      setAnswer(r);
      if (r.status === 'EVALUATED' || r.status === 'PROCESSING_FAILED' || r.transcriptStatus === 'UNAVAILABLE') return;
    }
  }

  return (
    <>
      <PageHeader title="Speaking practice" subtitle="Answer out loud, then see a transcript and an AI estimate. Pronunciation is not judged from a transcript." />
      {error && <Alert>{error}</Alert>}

      {!attempt && (
        <Card className="max-w-2xl space-y-4">
          <Field label="Part">{(p) => <Select {...p} value={part} onChange={(e) => setPart(e.target.value as Part)}>{(['PART1', 'PART2', 'PART3'] as Part[]).map((x) => <option key={x} value={x}>{PART_LABEL[x]}</option>)}</Select>}</Field>
          {questions.isLoading && <Loading />}
          {questions.data && questions.data.length === 0 && <p className="text-sm text-fg-muted">No published questions for this part yet. You can still practise with a sample question.</p>}
          <Button onClick={begin} busy={busy}>Start practice</Button>
        </Card>
      )}

      {attempt && question && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-4">
            <p className="text-xs uppercase tracking-wide text-fg-subtle">{PART_LABEL[part]}</p>
            <p className="font-display text-lg text-fg">{question.prompt}</p>
            <p className="text-sm text-fg-muted">Time limit: {Math.round(MAX_SECONDS[part] / 60 * 10) / 10} min</p>

            {!answer?.id || answer.status === 'UPLOADING' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  {rec.state.kind !== 'recording'
                    ? <Button variant="secondary" onClick={() => rec.start()}>● Record answer</Button>
                    : <Button variant="danger" onClick={rec.stop}>■ Stop ({Math.floor(rec.elapsed / 60)}:{String(rec.elapsed % 60).padStart(2, '0')})</Button>}
                  <span className="text-sm text-fg-subtle">Microphone access is needed.</span>
                </div>
                {rec.state.kind === 'ready' && <audio controls src={rec.state.url} className="w-full" />}
                {rec.state.kind === 'error' && <Alert>{rec.state.message}</Alert>}
                <Button onClick={upload} busy={busy} disabled={rec.state.kind !== 'ready'}>Submit answer</Button>
              </div>
            ) : (
              <p className="text-sm text-fg-muted">Answer saved. {answer.status === 'EVALUATED' ? 'Your feedback is ready.' : 'Working on your feedback…'}</p>
            )}

            {answer && ['EVALUATED', 'PROCESSING_FAILED'].includes(answer.status) && (
              <Button variant="secondary" onClick={() => nextQuestion(attempt.id)}>Next question</Button>
            )}
          </Card>

          <section className="space-y-4">
            {answer?.status === 'UPLOADED' || answer?.status === 'PROCESSING' ? <Loading /> : null}
            {answer?.status === 'PROCESSING_FAILED' && <AiUnavailable />}
            {answer?.transcript && (
              <Card className="space-y-2">
                <h3 className="font-semibold text-fg">Transcript</h3>
                <p className="whitespace-pre-wrap text-sm text-fg-muted">{answer.transcript}</p>
              </Card>
            )}
            {answer?.latestEvaluation && (
              <AIInsightCard title="Speaking feedback" estimate={answer.latestEvaluation.estimatedBand}>
                <div className="space-y-4">
                  <ScoreBreakdown items={answer.latestEvaluation.criteria.map((c) => ({ label: CRITERIA[c.key] ?? c.key, score: c.score }))} />
                  <List title="Strengths" items={answer.latestEvaluation.feedback.strengths} />
                  <List title="To work on" items={answer.latestEvaluation.feedback.weaknesses} />
                  {answer.latestEvaluation.feedback.corrections.length > 0 && (
                    <ul className="space-y-2 text-sm">{answer.latestEvaluation.feedback.corrections.map((c, i) => <li key={i}><span className="text-fg-muted">{c.original}</span><span className="block text-success">{c.corrected}</span></li>)}</ul>
                  )}
                  <List title="Practise next" items={answer.latestEvaluation.feedback.recommendedPractice} />
                  <p className="text-xs text-fg-subtle">{answer.latestEvaluation.feedback.pronunciationNote}</p>
                </div>
              </AIInsightCard>
            )}
            {!answer && <Empty title="Record an answer to begin">Your transcript and feedback will appear here.</Empty>}
          </section>
        </div>
      )}
    </>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1 font-medium text-fg">{title}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}
