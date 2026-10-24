'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Loading, PageHeader, Table, Tabs, Td, Textarea } from '@/components/ui';
import { SimulatorSpeaking } from '@/components/SimulatorSpeaking';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { label } from '@/lib/format';

interface WritingSection { responseId: string; status: string; wordCount: number }
interface Exam {
  id: string; status: string; stage: 'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING' | 'DONE'; stageRevision: number; includeSpeaking: boolean;
  stageDeadlineAt: string | null; secondsRemaining: number | null; overallEstimate: string | null; missingSkills: string[];
  sections: {
    listening: { attemptId: string; status: string; band: string | null } | null;
    reading: { attemptId: string; status: string; band: string | null } | null;
    writing: { task1: WritingSection | null; task2: WritingSection | null };
    speaking: { attemptId: string; status: string; answers: number } | null;
  };
}

interface QuestionReview { id: string; type: string; prompt: string; marks: number; options: { id: string; label: string }[]; yourAnswer: unknown; correct: boolean; correctAnswer: unknown }
interface SectionReview { id: string; title: string; questions: QuestionReview[] }
interface AttemptResult {
  attemptId: string; status: string; score: { raw: number | null; max: number | null; percent: number | null; band: number | null; passed: boolean | null };
  assessment: { title: string; skill: string };
  review: SectionReview[] | null;
}
interface WritingResult { taskType: string; status: string; wordCount: number; prompt: string; body: string; evaluation: { estimatedBand: string | null; criteria: unknown[]; feedback: unknown } | null }
interface SpeakingResponse { id: string; part: string; prompt: string; transcript: string | null; durationSec: string | null; evaluation: { estimatedBand: string | null } | null }
interface SpeakingResult { status: string; band: number | null; responses: SpeakingResponse[] }
interface Results { overall: number | null; missingSkills: string[]; listening: AttemptResult | null; reading: AttemptResult | null; writing: WritingResult | null; speaking: SpeakingResult | null }

const ORDER = ['LISTENING', 'READING', 'WRITING', 'SPEAKING', 'DONE'] as const;

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
        subtitle={done ? 'Finished — view your results below.' : `Stage: ${data.stage.toLowerCase()}`}
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

      {(data.stage === 'LISTENING' || data.stage === 'READING') && (
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
      )}

      {data.stage === 'WRITING' && (
        <DualWritingStage task1={data.sections.writing?.task1 ?? null} task2={data.sections.writing?.task2 ?? null} onAdvance={advance} busy={busy} />
      )}

      {data.stage === 'SPEAKING' && data.sections.speaking && (
        <SimulatorSpeaking attemptId={data.sections.speaking.attemptId} onFinish={advance} />
      )}

      {done && <SimulatorResults examId={id} overall={data.overallEstimate} missingSkills={data.missingSkills} includeSpeaking={data.includeSpeaking} />}
    </>
  );
}

function SimulatorResults({ examId, overall, missingSkills, includeSpeaking }: { examId: string; overall: string | null; missingSkills: string[]; includeSpeaking: boolean }) {
  const SKILL_TABS = useMemo(() => [
    ['listening', 'Listening'], ['reading', 'Reading'], ['writing', 'Writing'],
    ...(includeSpeaking ? [['speaking', 'Speaking']] : []),
  ] as const, [includeSpeaking]);

  const [tab, setTab] = useState<string>('listening');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['sim-results', examId],
    queryFn: () => api<Results>(`/simulator/exams/${examId}/results`),
  });

  return (
    <div className="space-y-6">
      <Card className="max-w-2xl">
        <h2 className="mb-1 font-semibold text-fg">Overall band estimate</h2>
        {overall ? (
          <p className="font-display text-4xl font-semibold text-fg">{overall}</p>
        ) : (
          <p className="text-sm text-fg-muted">No overall estimate — some sections could not be assessed.</p>
        )}
        {missingSkills.length > 0 && <p className="mt-2 text-sm text-fg-muted">Not assessed: {missingSkills.map((s) => label(s)).join(', ')}.</p>}
        <p className="mt-2 text-xs text-fg-subtle">Practice estimate only. Not an official IELTS result.</p>
      </Card>

      <div>
        <div className="mb-4 overflow-x-auto">
          <Tabs aria-label="Results by skill" variant="underline" value={tab} onChange={setTab}
            items={SKILL_TABS.map(([k, l]) => ({ key: k, label: l }))} />
        </div>

        {isLoading && <Loading />}
        {isError && <Alert>Could not load detailed results.</Alert>}

        {data && tab === 'listening' && <AttemptResultPanel result={data.listening} skill="Listening" />}
        {data && tab === 'reading' && <AttemptResultPanel result={data.reading} skill="Reading" />}
        {data && tab === 'writing' && <WritingResultPanel result={data.writing} />}
        {data && tab === 'speaking' && <SpeakingResultPanel result={data.speaking} />}
      </div>
    </div>
  );
}

function AttemptResultPanel({ result, skill }: { result: AttemptResult | null; skill: string }) {
  if (!result) return <Empty title={`No ${skill} result`}>This section was not completed.</Empty>;
  const { score, review } = result;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap gap-8">
          <Stat label="Band" value={score.band ?? '—'} />
          <Stat label="Score" value={score.raw !== null && score.max !== null ? `${score.raw} / ${score.max}` : '—'} />
          {score.percent !== null && <Stat label="Percentage" value={`${score.percent}%`} />}
        </div>
      </Card>
      {review ? review.map((section) => (
        <Card key={section.id}>
          {section.title && <h3 className="mb-3 font-medium text-fg">{section.title}</h3>}
          <Table head={['Question', 'Your answer', 'Correct?', 'Marks']} sticky>
            {section.questions.map((q, i) => (
              <tr key={q.id} className={q.correct ? '' : 'bg-danger-soft/30'}>
                <Td className="align-top">
                  <span className="mr-1 text-xs text-fg-muted">Q{i + 1}</span>
                  <span className="text-sm">{q.prompt}</span>
                </Td>
                <Td className="align-top text-sm">{formatAnswer(q.yourAnswer)}</Td>
                <Td><span className={q.correct ? 'text-success' : 'text-danger'}>{q.correct ? '✓' : '✗'}</span></Td>
                <Td className="tabular-nums text-sm">{q.marks}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )) : (
        <Alert>Detailed answer review is not available for this section.</Alert>
      )}
    </div>
  );
}

function WritingResultPanel({ result }: { result: WritingResult | null }) {
  if (!result) return <Empty title="No writing result">The writing section was not completed.</Empty>;
  const eval_ = result.evaluation;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap gap-8">
          <Stat label="Band" value={eval_ ? eval_.estimatedBand ?? '—' : '—'} />
          <Stat label="Words" value={result.wordCount} />
          <Stat label="Task type" value={result.taskType === 'TASK2' ? 'Task 2' : 'Task 1'} />
        </div>
      </Card>
      {result.prompt && <Card><p className="text-sm font-medium text-fg-muted mb-2">Prompt</p><p className="text-sm text-fg">{result.prompt}</p></Card>}
      <Card><p className="text-sm font-medium text-fg-muted mb-2">Your essay</p><p className="whitespace-pre-wrap text-sm text-fg">{result.body || <span className="text-fg-subtle italic">No essay submitted.</span>}</p></Card>
      {eval_ && Array.isArray(eval_.criteria) && eval_.criteria.length > 0 && (
        <Card>
          <p className="mb-3 text-sm font-medium text-fg-muted">Criteria scores</p>
          <Table head={['Criterion', 'Score', 'Comment']} sticky>
            {(eval_.criteria as { key: string; score: number; comment: string }[]).map((c) => (
              <tr key={c.key}><Td className="font-medium text-sm">{label(c.key)}</Td><Td className="tabular-nums">{c.score}</Td><Td className="text-sm">{c.comment}</Td></tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

function SpeakingResultPanel({ result }: { result: SpeakingResult | null }) {
  if (!result) return <Empty title="No speaking result">The speaking section was not completed.</Empty>;
  const parts = ['PART1', 'PART2', 'PART3'] as const;
  return (
    <div className="space-y-4">
      <Card>
        <Stat label="Band" value={result.band ?? '—'} />
      </Card>
      {parts.map((part) => {
        const responses = result.responses.filter((r) => r.part === part);
        if (responses.length === 0) return null;
        return (
          <Card key={part}>
            <h3 className="mb-3 font-medium text-fg">{label(part)}</h3>
            <div className="space-y-4">
              {responses.map((r) => (
                <div key={r.id} className="border-b border-border pb-4 last:border-0 last:pb-0">
                  <p className="text-sm font-medium text-fg">{r.prompt}</p>
                  {r.transcript ? (
                    <p className="mt-1 text-sm text-fg-muted">Transcript: {r.transcript}</p>
                  ) : (
                    <p className="mt-1 text-xs text-fg-subtle italic">Transcript not yet available.</p>
                  )}
                  {r.evaluation && <p className="mt-1 text-sm">Band estimate: <span className="font-medium">{r.evaluation.estimatedBand ?? '—'}</span></p>}
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Stat({ label: lbl, value }: { label: string; value: string | number }) {
  return <div><p className="text-xs text-fg-muted">{lbl}</p><p className="font-display text-2xl font-semibold text-fg tabular-nums">{value}</p></div>;
}

const formatAnswer = (a: unknown): string => {
  if (a === null || a === undefined) return '—';
  if (typeof a === 'string') return a;
  if (typeof a === 'object' && 'optionIds' in (a as object)) return ((a as { optionIds: string[] }).optionIds).join(', ');
  return JSON.stringify(a);
};

function DualWritingStage({ task1, task2, onAdvance, busy: parentBusy }: { task1: WritingSection | null; task2: WritingSection | null; onAdvance: () => void; busy: boolean }) {
  const [activeTask, setActiveTask] = useState<'TASK1' | 'TASK2'>('TASK1');
  const task1Done = !task1 || task1.status !== 'DRAFT';
  const task2Done = !task2 || task2.status !== 'DRAFT';
  const canAdvance = task1Done && task2Done;

  if (!task1 && !task2) return (
    <Card className="max-w-2xl space-y-3">
      <p className="text-fg-muted">No writing tasks were assigned for this session.</p>
      <Button onClick={onAdvance} busy={parentBusy}>Continue</Button>
    </Card>
  );

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex gap-2">
        {task1 && <button onClick={() => setActiveTask('TASK1')} className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${activeTask === 'TASK1' ? 'bg-primary text-white' : 'bg-surface-muted text-fg hover:bg-primary-soft hover:text-primary'}`}>
          Task 1{task1Done ? ' ✓' : ''}
        </button>}
        {task2 && <button onClick={() => setActiveTask('TASK2')} className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${activeTask === 'TASK2' ? 'bg-primary text-white' : 'bg-surface-muted text-fg hover:bg-primary-soft hover:text-primary'}`}>
          Task 2{task2Done ? ' ✓' : ''}
        </button>}
      </div>
      {activeTask === 'TASK1' && task1 && (
        <WritingStage responseId={task1.responseId} status={task1.status}
          onAdvance={task2 ? () => setActiveTask('TASK2') : onAdvance}
          advanceLabel={task2 ? 'Continue to Task 2' : undefined}
          busy={parentBusy} />
      )}
      {activeTask === 'TASK2' && task2 && (
        <WritingStage responseId={task2.responseId} status={task2.status}
          onAdvance={onAdvance} busy={parentBusy} />
      )}
      {!task1 && activeTask === 'TASK1' && task2 && (
        <WritingStage responseId={task2.responseId} status={task2.status} onAdvance={onAdvance} busy={parentBusy} />
      )}
      {canAdvance && task2 && activeTask !== 'TASK2' && (
        <div className="flex justify-end">
          <Button onClick={onAdvance} busy={parentBusy}>Submit and continue</Button>
        </div>
      )}
    </div>
  );
}

function WritingStage({ responseId, status, onAdvance, advanceLabel, busy: parentBusy }: { responseId: string; status: string; onAdvance: () => void; advanceLabel?: string; busy: boolean }) {
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
          ? <Button onClick={submit} busy={busy || parentBusy}>Submit essay</Button>
          : <Button onClick={onAdvance} busy={parentBusy}>{advanceLabel ?? 'Continue'}</Button>}
      </div>
      {status === 'EVALUATED' && <p className="text-sm text-fg-muted">Your essay is marked and kept with its AI estimate.</p>}
    </Card>
  );
}

const countWords = (t: string) => (t.match(/[A-Za-z''-]+/g) ?? []).length;
