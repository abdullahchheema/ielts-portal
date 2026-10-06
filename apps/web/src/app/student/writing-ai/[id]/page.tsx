'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AIInsightCard, AiUnavailable, Alert, Badge, Button, Card, Loading, PageHeader, ScoreBreakdown, Textarea } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface Criterion { key: string; score: number | null; comment: string }
interface Evaluation {
  estimatedBand: string; criteria: Criterion[];
  feedback: {
    strengths: string[]; taskIssues: string[]; coherenceIssues: string[];
    vocabularyIssues: { excerpt: string; suggestion: string }[];
    grammarIssues: { excerpt: string; correction: string; explanation: string }[];
    sentenceCorrections: { original: string; corrected: string }[];
    suggestions: string[];
  };
}
interface Essay {
  id: string; taskType: 'TASK1' | 'TASK2'; promptText: string; body: string; wordCount: number; status: 'DRAFT' | 'SUBMITTED' | 'EVALUATED' | 'FAILED';
  revision: number; minWords: number;
  latestEvaluation: (Evaluation & { createdAt: string }) | null;
  stats: { words: number; paragraphs: number; sentences: number; typeTokenRatio: number; repeatedWords: { word: string; count: number }[]; weakPhrases: { match: string; suggestion: string }[] };
  history: { id: string; revision: number; estimatedBand: string | null; createdAt: string }[];
}

const CRITERIA_LABEL: Record<string, string> = { TASK_RESPONSE: 'Task response', COHERENCE: 'Coherence and cohesion', LEXICAL: 'Lexical resource', GRAMMAR: 'Grammatical range and accuracy' };

export default function WritingEssayPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['essay', id],
    queryFn: () => api<Essay>(`/writing/responses/${id}`),
    // Keep polling while the AI evaluation is pending.
    refetchInterval: (q) => (q.state.data?.status === 'SUBMITTED' ? 3000 : false),
  });
  const [body, setBody] = useState<string | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the server's text once, then keep the local copy as the editing source.
  useEffect(() => {
    if (data && body === null) { setBody(data.body); setRevision(data.revision); }
  }, [data, body]);

  async function save(text: string, rev: number) {
    setSaveState('saving');
    try {
      const out = await api<{ revision: number }>(`/writing/responses/${id}`, { method: 'PUT', body: { revision: rev, body: text } });
      setRevision(out.revision);
      setSaveState('saved');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Another tab saved first. Adopt the newer text rather than overwrite it.
        const d = e.details as { revision?: number; body?: string } | undefined;
        if (d?.body !== undefined && d.revision !== undefined) { setBody(d.body); setRevision(d.revision); }
        setError('This essay changed in another tab. The latest text is shown.');
      } else {
        setError(errorMessage(e));
      }
      setSaveState('error');
    }
  }

  function onChange(text: string) {
    setBody(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (revision !== null) save(text, revision); }, 1500);
  }

  async function submit() {
    if (timer.current) clearTimeout(timer.current);
    setSubmitting(true); setError(null);
    try {
      if (revision !== null && body !== null) await save(body, revision);
      await api(`/writing/responses/${id}/submit`, { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['essay', id] });
    } catch (e) { setError(errorMessage(e)); } finally { setSubmitting(false); }
  }

  if (isLoading || body === null) return <Loading />;
  if (isError || !data) return <Alert>Could not load this essay.</Alert>;

  const editable = data.status === 'DRAFT';
  const words = data.status === 'DRAFT' ? countWords(body) : data.wordCount;
  const belowMin = words < data.minWords;
  const ev = data.latestEvaluation;

  return (
    <>
      <PageHeader
        title={data.taskType === 'TASK1' ? 'Writing · Task 1' : 'Writing · Task 2'}
        subtitle={data.promptText}
        actions={<Badge status={data.status} />}
      />
      {error && <Alert>{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <Textarea
            aria-label="Your essay"
            value={body}
            onChange={(e) => onChange(e.target.value)}
            readOnly={!editable}
            rows={22}
            className="font-serif text-[15px] leading-7"
          />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className={belowMin ? 'text-warning' : 'text-fg-muted'}>
              {words} words{belowMin ? ` · aim for at least ${data.minWords}` : ''} · {editable ? (saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved yet' : 'Saved') : 'Submitted'}
            </p>
            {editable && <Button onClick={submit} busy={submitting} disabled={words < 20}>Submit for feedback</Button>}
          </div>
        </section>

        <section className="space-y-4">
          {data.status === 'SUBMITTED' && (
            <Card className="space-y-2">
              <p className="font-medium text-fg">Preparing your feedback…</p>
              <p className="text-sm text-fg-muted">This usually takes under a minute. Your essay is saved either way.</p>
            </Card>
          )}
          {data.status === 'SUBMITTED' && <AiUnavailable />}

          {ev && (
            <AIInsightCard title="Writing feedback" estimate={ev.estimatedBand}>
              <div className="space-y-4">
                <ScoreBreakdown items={ev.criteria.map((c) => ({ label: CRITERIA_LABEL[c.key] ?? c.key, score: c.score }))} />
                <List title="Strengths" items={ev.feedback.strengths} />
                <List title="Task response" items={ev.feedback.taskIssues} />
                <List title="Coherence" items={ev.feedback.coherenceIssues} />
                {ev.feedback.grammarIssues.length > 0 && (
                  <div>
                    <p className="mb-1 font-medium text-fg">Grammar</p>
                    <ul className="space-y-2">{ev.feedback.grammarIssues.map((g, i) => <li key={i} className="text-sm"><span className="line-through text-fg-muted">{g.excerpt}</span> → <span className="text-success">{g.correction}</span><span className="block text-xs text-fg-subtle">{g.explanation}</span></li>)}</ul>
                  </div>
                )}
                {ev.feedback.sentenceCorrections.length > 0 && (
                  <div>
                    <p className="mb-1 font-medium text-fg">Sentence corrections</p>
                    <ul className="space-y-2">{ev.feedback.sentenceCorrections.map((c, i) => <li key={i} className="text-sm"><span className="text-fg-muted">{c.original}</span><span className="block text-success">{c.corrected}</span></li>)}</ul>
                  </div>
                )}
                <List title="Vocabulary" items={ev.feedback.vocabularyIssues.map((v) => `“${v.excerpt}” → ${v.suggestion}`)} />
                <List title="Next steps" items={ev.feedback.suggestions} />
              </div>
            </AIInsightCard>
          )}

          <Card className="space-y-2">
            <h3 className="font-semibold text-fg">Measurements</h3>
            <p className="text-sm text-fg-muted">{data.stats.words} words · {data.stats.paragraphs} paragraphs · {data.stats.sentences} sentences</p>
            {data.stats.repeatedWords.length > 0 && (
              <p className="text-sm text-fg-muted">Repeated: {data.stats.repeatedWords.map((w) => `${w.word} (${w.count})`).join(', ')}</p>
            )}
            {data.stats.weakPhrases.length > 0 && (
              <ul className="text-sm text-fg-muted">{data.stats.weakPhrases.map((w, i) => <li key={i}>“{w.match}”: try {w.suggestion}</li>)}</ul>
            )}
            <p className="text-xs text-fg-subtle">These counts describe the text. They are not IELTS scoring criteria.</p>
          </Card>

          {data.history.length > 1 && (
            <Card className="space-y-2">
              <h3 className="font-semibold text-fg">Estimates over time</h3>
              <ul className="text-sm text-fg-muted">{data.history.map((h) => <li key={h.id}>AI estimate {h.estimatedBand} · {new Date(h.createdAt).toLocaleDateString()}</li>)}</ul>
            </Card>
          )}
        </section>
      </div>
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

const countWords = (t: string) => (t.match(/[A-Za-z’'-]+/g) ?? []).length;
