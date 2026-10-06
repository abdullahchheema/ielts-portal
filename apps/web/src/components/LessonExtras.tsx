'use client';

import { useConfirm } from '@/components/ui';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Card } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { extensionFor, useRecorder } from '@/lib/use-recorder';
import { band, date, label } from '@/lib/format';

export interface AssessmentSummary {
  id: string; title: string; type: string; skill: string | null; timeLimitMin: number | null; maxAttempts: number | null; passPercent: number;
  attemptsUsed: number; inProgressAttemptId: string | null; latestAttemptId: string | null; bestPercent: number | null; bestBand: number | null;
}
export interface AssignmentSummary {
  id: string; skill: 'WRITING' | 'SPEAKING'; instructions: string | null; dueAt: string | null; minWords: number | null; criteria: string[];
  current: { id: string; status: string; body?: string | null; revision: number } | null;
  history: { id: string; status: string; submittedAt: string; finalBand: number | null }[];
}

export function AssessmentCard({ a }: { a: AssessmentSummary }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = a.maxAttempts === null ? null : a.maxAttempts - a.attemptsUsed;

  async function start() {
    setBusy(true); setError(null);
    try { const res = await api<{ attempt: { id: string } }>(`/assessments/${a.id}/start`, { method: 'POST' }); router.push(`/student/attempts/${res.attempt.id}`); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{a.title}</h3><Badge status={a.type} tone="blue" /></div>
      <ul className="text-sm text-fg-muted">
        <li>{a.timeLimitMin ? `Time limit: ${a.timeLimitMin} minutes` : 'No time limit'}</li>
        <li>{a.maxAttempts ? `Attempts used: ${a.attemptsUsed} of ${a.maxAttempts}` : `Attempts used: ${a.attemptsUsed}`}</li>
        {a.passPercent > 0 && <li>Pass mark: {a.passPercent}%</li>}
        {a.bestPercent !== null && <li>Best score: <strong>{Math.round(a.bestPercent)}%</strong>{a.bestBand !== null && <> · Band <strong>{band(a.bestBand)}</strong></>}</li>}
      </ul>
      {a.timeLimitMin && !a.inProgressAttemptId && <Alert kind="info">The timer starts as soon as you begin and keeps running if you leave. Your answers are saved automatically.</Alert>}
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {a.inProgressAttemptId
          ? <Link href={`/student/attempts/${a.inProgressAttemptId}`} className="rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-white hover:bg-primary">Resume attempt</Link>
          : (left === null || left > 0) && <Button onClick={start} busy={busy}>{a.attemptsUsed ? 'Try again' : 'Start'}</Button>}
        {a.latestAttemptId && <Link href={`/student/attempts/${a.latestAttemptId}`} className="rounded-md px-3.5 py-2 text-sm font-medium text-fg ring-1 ring-border-strong hover:bg-canvas">Review last result</Link>}
      </div>
      {left === 0 && !a.inProgressAttemptId && <p className="text-sm text-fg-muted">You have used all attempts for this test.</p>}
    </Card>
  );
}

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

function Criteria({ items }: { items: string[] }) {
  if (!items.length) return null;
  return <p className="text-xs text-fg-muted">Marked on: {items.join(' · ')}</p>;
}

function History({ history }: { history: AssignmentSummary['history'] }) {
  if (!history.length) return null;
  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold">Your submissions</h4>
      <ul className="divide-y divide-border text-sm">
        {history.map((h) => (
          <li key={h.id} className="flex items-center justify-between py-1.5">
            <span>{date(h.submittedAt, true)}</span>
            <span className="flex items-center gap-3">{h.finalBand !== null && <strong>Band {band(h.finalBand)}</strong>}<Badge status={h.status} /><Link href={`/student/submissions/${h.id}`} className="text-primary underline">{h.status === 'GRADED' ? 'View feedback' : 'View'}</Link></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WritingPanel({ a, onChanged }: { a: AssignmentSummary; onChanged: () => void }) {
  const confirm = useConfirm();
  const [text, setText] = useState(a.current?.status === 'DRAFT' ? a.current.body ?? '' : '');
  const [state, setState] = useState<'saved' | 'saving' | 'offline' | 'conflict'>('saved');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const revision = useRef(a.current?.status === 'DRAFT' ? a.current.revision : 0);
  const lastSaved = useRef(a.current?.status === 'DRAFT' ? a.current.body ?? '' : '');
  const textRef = useRef(text);
  const key = `draft:${a.id}`;
  const waiting = a.current?.status === 'SUBMITTED';

  // Prefer a newer local copy (refresh, dropped connection).
  useEffect(() => {
    try { const local = localStorage.getItem(key); if (local && local !== lastSaved.current && !waiting) setText(local); } catch { /* ignore */ }
  }, [key, waiting]);

  const save = useCallback(async () => {
    const value = textRef.current;
    if (value === lastSaved.current) return;
    setState('saving');
    try {
      const res = await api<{ revision: number }>(`/assignments/${a.id}/draft`, { method: 'PUT', body: { body: value, revision: revision.current } });
      revision.current = res.revision; lastSaved.current = value; setState('saved');
    } catch (e) {
      setState(e instanceof ApiError && e.code === 'ANSWER_SAVE_CONFLICT' ? 'conflict' : 'offline');
    }
  }, [a.id]);

  useEffect(() => {
    textRef.current = text;
    try { localStorage.setItem(key, text); } catch { /* ignore */ }
    if (waiting) return;
    const t = setTimeout(save, 2000);
    return () => clearTimeout(t);
  }, [text, key, save, waiting]);
  useEffect(() => { const t = setInterval(save, 15_000); return () => clearInterval(t); }, [save]);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await api(`/assignments/${a.id}/submit-writing`, { method: 'POST', body: { body: text } });
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      onChanged();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  const words = wordCount(text);
  return (
    <Card className="space-y-3">
      <h3 className="font-semibold">Your answer</h3>
      {a.instructions && <p className="whitespace-pre-wrap text-sm text-fg">{a.instructions}</p>}
      <Criteria items={a.criteria} />
      {a.dueAt && <p className="text-xs text-fg-muted">Due {date(a.dueAt, true)}</p>}
      {waiting ? <Alert kind="info">Submitted — waiting for your mentor’s feedback. You’ll be notified when it is graded.</Alert> : (
        <>
          <textarea aria-label="Your answer" rows={16} value={text} onChange={(e) => setText(e.target.value)} spellCheck
            className="w-full rounded-md px-3 py-2 text-sm leading-relaxed ring-1 ring-inset ring-border-strong focus:ring-2 focus:ring-primary" />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className={a.minWords && words < a.minWords ? 'text-amber-700' : 'text-fg-muted'}>{words} word{words === 1 ? '' : 's'}{a.minWords ? ` (minimum ${a.minWords})` : ''}</span>
            <span aria-live="polite" className={state === 'offline' || state === 'conflict' ? 'text-danger' : 'text-fg-muted'}>
              {state === 'saved' ? 'Draft saved' : state === 'saving' ? 'Saving…' : state === 'offline' ? 'Offline — kept on this device' : 'Changed in another tab — reload'}
            </span>
          </div>
          {error && <Alert>{error}</Alert>}
          <Button onClick={() => confirm({ message: 'Submit for grading? You can’t edit it afterwards.', confirmLabel: 'Submit' }).then((ok) => { if (ok) { submit(); } })} busy={busy} disabled={words === 0}>Submit for grading</Button>
        </>
      )}
      <History history={a.history} />
    </Card>
  );
}

function SpeakingPanel({ a, onChanged }: { a: AssignmentSummary; onChanged: () => void }) {
  const confirm = useConfirm();
  const rec = useRecorder();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const waiting = a.current?.status === 'SUBMITTED';
  const recording = rec.state.kind === 'recording';
  const blob = rec.state.kind === 'ready' ? rec.state.blob : null;
  const url = rec.state.kind === 'ready' ? rec.state.url : null;
  const shownError = error ?? (rec.state.kind === 'error' ? rec.state.message : null);

  async function submit() {
    if (!blob) return;
    if (blob.size > 25 * 1024 * 1024) { setError('The recording is larger than 25 MB.'); return; }
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', blob, `answer.${extensionFor(blob.type)}`);
      await api(`/assignments/${a.id}/submit-audio`, { method: 'POST', form: fd });
      onChanged();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Card className="space-y-3">
      <h3 className="font-semibold">Your recording</h3>
      {a.instructions && <p className="whitespace-pre-wrap text-sm text-fg">{a.instructions}</p>}
      <Criteria items={a.criteria} />
      {waiting ? <Alert kind="info">Submitted — waiting for your mentor’s feedback.</Alert> : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {!recording ? <Button variant="secondary" onClick={() => { setError(null); rec.start(); }}>● Record</Button> : <Button variant="danger" onClick={rec.stop}>■ Stop ({Math.floor(rec.elapsed / 60)}:{String(rec.elapsed % 60).padStart(2, '0')})</Button>}
            <label className="cursor-pointer text-sm text-primary underline">or upload a file
              <input type="file" className="sr-only" accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) rec.chooseFile(f); }} />
            </label>
          </div>
          {url && <audio controls src={url} className="w-full" />}
          {shownError && <Alert>{shownError}</Alert>}
          <Button onClick={() => confirm({ message: 'Submit this recording for grading?', confirmLabel: 'Submit' }).then((ok) => { if (ok) { submit(); } })} busy={busy} disabled={!blob || recording}>Submit recording</Button>
        </>
      )}
      <History history={a.history} />
    </Card>
  );
}

export function AssignmentPanel({ a, itemId }: { a: AssignmentSummary; itemId: string }) {
  const qc = useQueryClient();
  const changed = () => { qc.invalidateQueries({ queryKey: ['content', itemId] }); qc.invalidateQueries({ queryKey: ['course'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  return a.skill === 'WRITING' ? <WritingPanel a={a} onChanged={changed} /> : <SpeakingPanel a={a} onChanged={changed} />;
}

export const skillLabel = (s: string) => label(s);
