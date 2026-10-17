'use client';

import { useQuery } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import { AIInsightCard, Accordion, AiUnavailable, Alert, Badge, Button, Card, Empty, Field, FeedbackList, Loading, PageHeader, ScoreBreakdown, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { planHas, usePlan } from '@/lib/plan';
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
  const { data: plan } = usePlan();
  const hasAi = planHas(plan, 'ai.evaluation');

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
      {plan && !hasAi && (
        <div className="mb-4"><Alert kind="info">You can record and save answers on your current plan, but the AI transcript and estimate require the Advanced or Premium plan. <a href="/pricing" className="font-semibold underline">See plans</a>.</Alert></div>
      )}
      {error && <Alert>{error}</Alert>}

      {!attempt && (
        <Card className="max-w-2xl space-y-4">
          <Field label="Part">{(p) => <Select {...p} value={part} onChange={(e) => setPart(e.target.value as Part)}>{(['PART1', 'PART2', 'PART3'] as Part[]).map((x) => <option key={x} value={x}>{PART_LABEL[x]}</option>)}</Select>}</Field>
          {questions.isLoading && <Loading />}
          {questions.data && questions.data.length === 0 && <Alert kind="info">No published questions for this part yet. You can still practise with a sample question.</Alert>}
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
              <p className="flex items-center gap-2 text-sm text-fg-muted">
                Answer saved
                <Badge status={answer.status} />
                {answer.status === 'EVALUATED' ? 'Your feedback is ready.' : 'Working on your feedback…'}
              </p>
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
                  <FeedbackList title="Strengths" items={answer.latestEvaluation.feedback.strengths} />
                  <FeedbackList title="To work on" items={answer.latestEvaluation.feedback.weaknesses} />
                  <Accordion
                    items={[
                      answer.latestEvaluation.feedback.corrections.length > 0 && {
                        key: 'corrections',
                        title: `Corrections (${answer.latestEvaluation.feedback.corrections.length})`,
                        content: <ul className="space-y-2 text-sm">{answer.latestEvaluation.feedback.corrections.map((c, i) => <li key={i}><span className="text-fg-muted">{c.original}</span><span className="block text-success">{c.corrected}</span></li>)}</ul>,
                      },
                      answer.latestEvaluation.feedback.recommendedPractice.length > 0 && {
                        key: 'practice',
                        title: 'Practise next',
                        content: <FeedbackList title="Practise next" items={answer.latestEvaluation.feedback.recommendedPractice} />,
                      },
                      answer.latestEvaluation.feedback.pronunciationNote && {
                        key: 'pronunciation',
                        title: 'Pronunciation note',
                        content: <p className="text-sm text-fg-muted">{answer.latestEvaluation.feedback.pronunciationNote}</p>,
                      },
                    ].filter(Boolean) as { key: string; title: string; content: ReactNode }[]}
                  />
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
