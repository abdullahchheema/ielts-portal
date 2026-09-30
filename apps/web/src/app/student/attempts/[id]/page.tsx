'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Loading, PageHeader } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { band, label } from '@/lib/format';

interface Option { id: string; label: string }
interface Question { id: string; type: string; prompt: { text: string }; marks: number; options?: Option[] }
interface Section { id: string; title: string; content: { passage?: string; instructions?: string; audioUrl?: string }; questions: Question[] }
type Answers = Record<string, unknown>;
interface Paper { attempt: { id: string; revision: number; remainingSeconds: number | null; attemptNumber: number }; assessment: { title: string; type: string; timeLimitMin: number | null }; paper: Section[]; answers: Answers }
interface ReviewQ extends Question { yourAnswer: Record<string, unknown> | null; correct: boolean; correctAnswer: { optionIds?: string[]; value?: string; accepted?: string[] } | null }
interface Result {
  attemptNumber: number; assessment: { title: string; type: string; skill: string | null; passPercent: number };
  score: { raw: number; max: number; percent: number; band: number | null; passed: boolean | null };
  review: { id: string; title: string; questions: ReviewQ[] }[] | null;
}
interface AttemptResponse extends Partial<Paper> { result?: Result }

const TFNG = [['TRUE', 'True'], ['FALSE', 'False'], ['NOT_GIVEN', 'Not given']];
const YNNG = [['YES', 'Yes'], ['NO', 'No'], ['NOT_GIVEN', 'Not given']];

function QuestionInput({ q, value, onChange, disabled }: { q: Question; value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  const v = (value ?? {}) as { optionIds?: string[]; value?: string; text?: string };
  if (q.type === 'TFNG' || q.type === 'YNNG') {
    return (
      <div role="radiogroup" aria-label={q.prompt.text} className="flex flex-wrap gap-2">
        {(q.type === 'TFNG' ? TFNG : YNNG).map(([val, text]) => (
          <label key={val} className={`cursor-pointer rounded-md px-3 py-1.5 text-sm ring-1 ${v.value === val ? 'bg-indigo-50 ring-2 ring-indigo-500' : 'ring-slate-300'}`}>
            <input type="radio" className="sr-only" name={q.id} disabled={disabled} checked={v.value === val} onChange={() => onChange({ value: val })} />{text}
          </label>
        ))}
      </div>
    );
  }
  if (q.type === 'COMPLETION') {
    return <input aria-label={q.prompt.text} disabled={disabled} className="w-full max-w-sm rounded-md px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600" value={v.text ?? ''} maxLength={500} autoComplete="off" onChange={(e) => onChange({ text: e.target.value })} />;
  }
  const multi = q.type === 'MCQ_MULTI';
  const chosen = v.optionIds ?? [];
  return (
    <ul className="space-y-1.5">
      {q.options?.map((o) => (
        <li key={o.id}>
          <label className={`flex cursor-pointer items-start gap-2 rounded-md p-2 text-sm ring-1 ${chosen.includes(o.id) ? 'bg-indigo-50 ring-2 ring-indigo-500' : 'ring-slate-200'}`}>
            <input type={multi ? 'checkbox' : 'radio'} name={q.id} disabled={disabled} className="mt-0.5" checked={chosen.includes(o.id)}
              onChange={(e) => onChange({ optionIds: multi ? (e.target.checked ? [...chosen, o.id] : chosen.filter((x) => x !== o.id)) : [o.id] })} />
            {o.label}
          </label>
        </li>
      ))}
      {multi && <li className="text-xs text-slate-500">Choose all that apply.</li>}
    </ul>
  );
}

function ResultView({ r, lessonHref }: { r: Result; lessonHref: string }) {
  const { score } = r;
  return (
    <>
      <PageHeader title={r.assessment.title} subtitle={`Attempt ${r.attemptNumber} — results`} actions={score.passed !== null ? <Badge status={score.passed ? 'APPROVED' : 'REJECTED'} tone={score.passed ? 'green' : 'red'} /> : undefined} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card><p className="text-sm text-slate-500">Score</p><p className="text-3xl font-semibold">{score.raw} / {score.max}</p></Card>
        <Card><p className="text-sm text-slate-500">Percentage</p><p className="text-3xl font-semibold">{Math.round(score.percent)}%</p>{r.assessment.passPercent > 0 && <p className="text-xs text-slate-500">Pass mark {r.assessment.passPercent}%</p>}</Card>
        <Card><p className="text-sm text-slate-500">Estimated band</p><p className="text-3xl font-semibold">{band(score.band)}</p>{score.band === null && <p className="text-xs text-slate-500">Bands are shown for listening and reading tests.</p>}</Card>
      </div>
      <div className="mb-6"><Link href={lessonHref} className="text-sm text-indigo-700 underline">← Back to the course</Link></div>
      {r.review ? r.review.map((s) => (
        <section key={s.id} className="mb-6">
          <h2 className="mb-2 font-semibold">{s.title}</h2>
          <ol className="space-y-3">
            {s.questions.map((q, i) => (
              <li key={q.id}><Card className={q.correct ? 'ring-green-300' : 'ring-red-300'}>
                <p className="mb-2 text-sm font-medium"><span className="mr-2 text-slate-400">{i + 1}.</span>{q.prompt.text} <span className={q.correct ? 'text-green-700' : 'text-red-700'}>{q.correct ? '✓ Correct' : '✗ Incorrect'}</span></p>
                <p className="text-sm text-slate-600">Your answer: <strong>{describe(q, q.yourAnswer)}</strong></p>
                {!q.correct && <p className="text-sm text-slate-600">Correct answer: <strong>{describe(q, q.correctAnswer)}</strong></p>}
              </Card></li>
            ))}
          </ol>
        </section>
      )) : <Alert kind="info">Your mentor has chosen not to show correct answers for this test.</Alert>}
    </>
  );
}

function describe(q: ReviewQ, a: Record<string, unknown> | ReviewQ['correctAnswer'] | null): string {
  if (!a) return '—';
  const x = a as { optionIds?: string[]; value?: string; text?: string; accepted?: string[] };
  if (x.optionIds) return x.optionIds.map((id) => q.options?.find((o) => o.id === id)?.label ?? '?').join(', ') || '—';
  if (x.value) return label(x.value);
  if (x.accepted) return x.accepted.join(' / ');
  return x.text?.trim() || '—';
}

export default function AttemptPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['attempt', id], queryFn: () => api<AttemptResponse>(`/attempts/${id}`), staleTime: Infinity });

  const [answers, setAnswers] = useState<Answers>({});
  const [remaining, setRemaining] = useState<number | null>(null);
  const [status, setStatus] = useState<'saved' | 'saving' | 'offline' | 'conflict'>('saved');
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const revision = useRef(0);
  const dirty = useRef(new Set<string>());
  const inFlight = useRef(false);
  const submitted = useRef(false);
  const storageKey = `attempt:${id}`;

  // Initialise from the server, then overlay any newer local copy (e.g. after a dropped connection or a refresh).
  useEffect(() => {
    if (!data) return;
    if (data.result) { setResult(data.result); return; }
    revision.current = data.attempt!.revision;
    setRemaining(data.attempt!.remainingSeconds ?? null);
    let local: Answers = {};
    try { local = JSON.parse(localStorage.getItem(storageKey) ?? '{}'); } catch { /* ignore */ }
    const merged: Answers = { ...data.answers };
    for (const [k, v] of Object.entries(local)) if (JSON.stringify(v) !== JSON.stringify(merged[k])) { merged[k] = v; dirty.current.add(k); }
    setAnswers(merged);
  }, [data, storageKey]);

  const flush = useCallback(async () => {
    if (inFlight.current || submitted.current || dirty.current.size === 0) return;
    inFlight.current = true; setStatus('saving');
    const ids = [...dirty.current];
    const snapshot = ids.map((qid) => ({ questionVersionId: qid, answer: answersRef.current[qid] ?? null }));
    try {
      const res = await api<{ revision: number }>(`/attempts/${id}/answers`, { method: 'PUT', body: { revision: revision.current, answers: snapshot } });
      revision.current = res.revision;
      ids.forEach((qid) => { if (JSON.stringify(answersRef.current[qid] ?? null) === JSON.stringify(snapshot.find((s) => s.questionVersionId === qid)!.answer)) dirty.current.delete(qid); });
      setStatus(dirty.current.size ? 'saving' : 'saved');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ANSWER_SAVE_CONFLICT') setStatus('conflict');
      else if (e instanceof ApiError && (e.code === 'ATTEMPT_EXPIRED' || e.code === 'ATTEMPT_ALREADY_SUBMITTED')) { submitted.current = true; qc.removeQueries({ queryKey: ['attempt', id] }); window.location.reload(); }
      else setStatus('offline'); // keep the local copy; the next tick retries
    } finally { inFlight.current = false; }
  }, [id, qc]);

  const answersRef = useRef<Answers>({});
  useEffect(() => { answersRef.current = answers; try { localStorage.setItem(storageKey, JSON.stringify(answers)); } catch { /* storage may be blocked */ } }, [answers, storageKey]);

  // Save shortly after a change, and retry every 10s (covers going offline and coming back).
  useEffect(() => {
    const t = setInterval(flush, 10_000);
    return () => clearInterval(t);
  }, [flush]);
  useEffect(() => {
    const t = setTimeout(flush, 1500);
    return () => clearTimeout(t);
  }, [answers, flush]);
  useEffect(() => {
    const onOnline = () => flush();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [flush]);

  const submit = useCallback(async (auto = false) => {
    if (submitted.current) return;
    setSubmitting(true); setMsg(null);
    try {
      await flush();
      const res = await api<Result>(`/attempts/${id}/submit`, { method: 'POST' });
      submitted.current = true;
      try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
      setResult(res);
      qc.invalidateQueries({ queryKey: ['course'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['skills'] });
      if (auto) setMsg('Time is up — your answers were submitted.');
    } catch (e) { setMsg(errorMessage(e)); } finally { setSubmitting(false); }
  }, [flush, id, qc, storageKey]);

  // Countdown; auto-submit at zero.
  useEffect(() => {
    if (remaining === null || result) return;
    if (remaining <= 0) { submit(true); return; }
    const t = setTimeout(() => setRemaining((r) => (r === null ? r : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining, result, submit]);

  const total = useMemo(() => data?.paper?.reduce((n, s) => n + s.questions.length, 0) ?? 0, [data]);
  const answered = Object.keys(answers).filter((k) => answers[k] !== null && answers[k] !== undefined).length;

  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>{errorMessage(error)}</Alert>;
  if (result) return <ResultView r={result} lessonHref="/student/course" />;

  const mm = remaining !== null ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : null;
  const low = remaining !== null && remaining < 300;

  return (
    <>
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div><h1 className="font-semibold">{data.assessment!.title}</h1><p className="text-xs text-slate-500">{label(data.assessment!.type)} · attempt {data.attempt!.attemptNumber} · {answered}/{total} answered</p></div>
        <div className="flex items-center gap-4 text-sm">
          <span aria-live="polite" className={status === 'offline' || status === 'conflict' ? 'text-red-600' : 'text-slate-500'}>
            {status === 'saved' ? 'All changes saved' : status === 'saving' ? 'Saving…' : status === 'offline' ? 'Offline — saved on this device' : 'Changed elsewhere'}
          </span>
          {mm && <span role="timer" aria-label="Time remaining" className={`rounded-md px-2.5 py-1 font-mono text-base font-semibold ${low ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-800'}`}>{mm}</span>}
          <Button onClick={() => confirm(answered < total ? `You have answered ${answered} of ${total} questions. Submit anyway?` : 'Submit your answers?') && submit()} busy={submitting}>Submit</Button>
        </div>
      </div>
      {msg && <div className="mb-4"><Alert>{msg}</Alert></div>}
      {status === 'conflict' && (
        <div className="mb-4"><Alert kind="warning">These answers were changed in another tab or device. <button className="font-medium underline" onClick={() => { try { localStorage.removeItem(storageKey); } catch { /* ignore */ } qc.removeQueries({ queryKey: ['attempt', id] }); window.location.reload(); }}>Reload the latest saved answers</button></Alert></div>
      )}

      <div className="space-y-8">
        {data.paper!.map((s) => (
          <section key={s.id} aria-labelledby={`s-${s.id}`}>
            <h2 id={`s-${s.id}`} className="mb-2 text-lg font-semibold">{s.title}</h2>
            {s.content.instructions && <p className="mb-3 text-sm text-slate-600">{s.content.instructions}</p>}
            {s.content.audioUrl && <audio controls className="mb-4 w-full" src={s.content.audioUrl} />}
            <div className={s.content.passage ? 'grid gap-6 lg:grid-cols-2' : ''}>
              {s.content.passage && <Card className="max-h-[70vh] overflow-auto whitespace-pre-wrap text-sm leading-relaxed lg:sticky lg:top-24">{s.content.passage}</Card>}
              <ol className="space-y-4">
                {s.questions.map((q, i) => (
                  <li key={q.id}><Card>
                    <p className="mb-3 text-sm font-medium"><span className="mr-2 text-slate-400">{i + 1}.</span>{q.prompt.text}</p>
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
