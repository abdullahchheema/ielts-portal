'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Loading, PageHeader } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { band } from '@/lib/format';

interface Option { id: string; label: string }
interface Question { id: string; type: string; prompt: { text: string }; marks: number; options?: Option[] }
interface Section { id: string; title: string; content: { passage?: string; instructions?: string; audioUrl?: string }; questions: Question[] }
type Answers = Record<string, unknown>;
interface StartResponse { attempt: { id: string; revision: number; remainingSeconds: number | null }; assessment: { title: string }; paper: Section[]; answers: Answers }
interface FreeResult { score: { raw: number | null; max: number | null; percent: number | null; band: number | null }; assessment: { title: string }; completedAt: string | null; status: string }

const TFNG = [['TRUE', 'True'], ['FALSE', 'False'], ['NOT_GIVEN', 'Not given']];
const YNNG = [['YES', 'Yes'], ['NO', 'No'], ['NOT_GIVEN', 'Not given']];

function QuestionInput({ q, value, onChange, disabled }: { q: Question; value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  const v = (value ?? {}) as { optionIds?: string[]; value?: string; text?: string };
  if (q.type === 'TFNG' || q.type === 'YNNG') {
    return (
      <div role="radiogroup" aria-label={q.prompt.text} className="flex flex-wrap gap-2">
        {(q.type === 'TFNG' ? TFNG : YNNG).map(([val, text]) => (
          <label key={val} className={`cursor-pointer rounded-md px-3 py-1.5 text-sm ring-1 ${v.value === val ? 'bg-primary-soft ring-2 ring-primary' : 'ring-border-strong'}`}>
            <input type="radio" className="sr-only" name={q.id} disabled={disabled} checked={v.value === val} onChange={() => onChange({ value: val })} />{text}
          </label>
        ))}
      </div>
    );
  }
  if (q.type === 'COMPLETION') {
    return <input aria-label={q.prompt.text} disabled={disabled} className="w-full max-w-sm rounded-md px-3 py-2 text-sm ring-1 ring-inset ring-border-strong focus:ring-2 focus:ring-primary" value={v.text ?? ''} maxLength={500} autoComplete="off" onChange={(e) => onChange({ text: e.target.value })} />;
  }
  if (q.options?.length) {
    const multi = q.type === 'MCQ_MULTI';
    const chosen = v.optionIds ?? [];
    return (
      <ul className="space-y-1.5">
        {q.options.map((o) => (
          <li key={o.id}>
            <label className={`flex cursor-pointer items-start gap-2 rounded-md p-2 text-sm ring-1 ${chosen.includes(o.id) ? 'bg-primary-soft ring-2 ring-primary' : 'ring-border'}`}>
              <input type={multi ? 'checkbox' : 'radio'} name={q.id} disabled={disabled} className="mt-0.5" checked={chosen.includes(o.id)}
                onChange={(e) => onChange({ optionIds: multi ? (e.target.checked ? [...chosen, o.id] : chosen.filter((x) => x !== o.id)) : [o.id] })} />
              {o.label}
            </label>
          </li>
        ))}
        {multi && <li className="text-xs text-fg-muted">Choose all that apply.</li>}
      </ul>
    );
  }
  return <p className="text-xs text-fg-muted">This question type is not supported in the free test preview.</p>;
}

function FreeResultView({ r }: { r: FreeResult }) {
  return (
    <>
      <PageHeader title={r.assessment.title} subtitle="Your free test result" />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card><p className="text-sm text-fg-muted">Score</p><p className="text-3xl font-semibold">{r.score.raw ?? '—'} / {r.score.max ?? '—'}</p></Card>
        <Card><p className="text-sm text-fg-muted">Percentage</p><p className="text-3xl font-semibold">{r.score.percent !== null ? `${Math.round(r.score.percent)}%` : '—'}</p></Card>
        <Card><p className="text-sm text-fg-muted">Estimated band</p><p className="text-3xl font-semibold">{band(r.score.band)}</p></Card>
      </div>
      <Card className="mb-6">
        <h2 className="mb-2 font-semibold">Want the full picture?</h2>
        <p className="mb-4 text-sm text-fg-muted">
          The free test shows your overall score only. Register for a Starter plan or above to see which
          questions you got right or wrong, the correct answers, and a breakdown by skill — plus unlimited
          practice and mock tests.
        </p>
        <Link href="/pricing"><Button>See plans and register</Button></Link>
      </Card>
      <Badge status={r.status} />
    </>
  );
}

export default function FreeTestPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paper, setPaper] = useState<StartResponse | null>(null);
  const [result, setResult] = useState<FreeResult | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [status, setStatus] = useState<'saved' | 'saving' | 'offline' | 'conflict'>('saved');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const revision = useRef(0);
  const dirty = useRef(new Set<string>());
  const answersRef = useRef<Answers>({});
  const inFlight = useRef(false);
  const submitted = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api<StartResponse | { attempt: { id: string }; result: FreeResult }>(`/free-test/${leadId}/start`, { method: 'POST' });
        if ('result' in res) { setResult(res.result); return; }
        setPaper(res);
        revision.current = res.attempt.revision;
        setAnswers(res.answers);
      } catch (e) { setLoadError(errorMessage(e)); } finally { setLoading(false); }
    })();
  }, [leadId]);

  useEffect(() => { answersRef.current = answers; }, [answers]);

  const flush = useCallback(async () => {
    if (inFlight.current || submitted.current || dirty.current.size === 0) return;
    inFlight.current = true; setStatus('saving');
    const ids = [...dirty.current];
    const snapshot = ids.map((qid) => ({ questionVersionId: qid, answer: answersRef.current[qid] ?? null }));
    try {
      const res = await api<{ revision: number }>(`/free-test/${leadId}/answers`, { method: 'PUT', body: { revision: revision.current, answers: snapshot } });
      revision.current = res.revision;
      ids.forEach((qid) => dirty.current.delete(qid));
      setStatus(dirty.current.size ? 'saving' : 'saved');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ANSWER_SAVE_CONFLICT') setStatus('conflict');
      else setStatus('offline');
    } finally { inFlight.current = false; }
  }, [leadId]);

  useEffect(() => {
    const t = setInterval(flush, 10_000);
    return () => clearInterval(t);
  }, [flush]);
  useEffect(() => {
    const t = setTimeout(flush, 1500);
    return () => clearTimeout(t);
  }, [answers, flush]);

  async function submit() {
    setSubmitting(true); setMsg(null);
    try {
      await flush();
      const res = await api<FreeResult>(`/free-test/${leadId}/submit`, { method: 'POST' });
      submitted.current = true;
      setResult(res);
    } catch (e) { setMsg(errorMessage(e)); } finally { setSubmitting(false); }
  }

  if (loading) return <Loading />;
  if (loadError) return <Alert>{loadError}</Alert>;
  if (result) return <FreeResultView r={result} />;
  if (!paper) return <Alert>Something went wrong loading the test.</Alert>;

  const total = paper.paper.reduce((n, s) => n + s.questions.length, 0);
  const answered = Object.keys(answers).filter((k) => answers[k] !== null && answers[k] !== undefined).length;

  return (
    <>
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div><h1 className="font-display font-semibold text-fg">{paper.assessment.title}</h1><p className="text-xs text-fg-muted">Free test · {answered}/{total} answered</p></div>
        <div className="flex items-center gap-4 text-sm">
          <span aria-live="polite" className={status === 'offline' || status === 'conflict' ? 'text-danger' : 'text-fg-muted'}>
            {status === 'saved' ? 'All changes saved' : status === 'saving' ? 'Saving…' : status === 'offline' ? 'Offline — will retry' : 'Changed elsewhere'}
          </span>
          <Button onClick={submit} busy={submitting}>Submit</Button>
        </div>
      </div>
      {msg && <div className="mb-4"><Alert>{msg}</Alert></div>}
      <div className="space-y-8">
        {paper.paper.map((s) => (
          <section key={s.id} aria-labelledby={`s-${s.id}`}>
            <h2 id={`s-${s.id}`} className="mb-2 text-lg font-semibold">{s.title}</h2>
            {s.content.instructions && <p className="mb-3 text-sm text-fg-muted">{s.content.instructions}</p>}
            {s.content.audioUrl && <audio controls className="mb-4 w-full" src={s.content.audioUrl} />}
            <div className={s.content.passage ? 'grid gap-6 lg:grid-cols-2' : ''}>
              {s.content.passage && <Card className="max-h-[70vh] overflow-auto whitespace-pre-wrap text-sm leading-relaxed lg:sticky lg:top-24">{s.content.passage}</Card>}
              <ol className="space-y-4">
                {s.questions.map((q, i) => (
                  <li key={q.id}><Card>
                    <p className="mb-3 text-sm font-medium"><span className="mr-2 text-fg-subtle">{i + 1}.</span>{q.prompt.text}</p>
                    <QuestionInput q={q} value={answers[q.id]} onChange={(v) => { dirty.current.add(q.id); setAnswers((a) => ({ ...a, [q.id]: v })); }} />
                  </Card></li>
                ))}
              </ol>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
