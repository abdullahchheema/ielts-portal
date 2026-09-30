'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Card } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
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
      <ul className="text-sm text-slate-600">
        <li>{a.timeLimitMin ? `Time limit: ${a.timeLimitMin} minutes` : 'No time limit'}</li>
        <li>{a.maxAttempts ? `Attempts used: ${a.attemptsUsed} of ${a.maxAttempts}` : `Attempts used: ${a.attemptsUsed}`}</li>
        {a.passPercent > 0 && <li>Pass mark: {a.passPercent}%</li>}
        {a.bestPercent !== null && <li>Best score: <strong>{Math.round(a.bestPercent)}%</strong>{a.bestBand !== null && <> · Band <strong>{band(a.bestBand)}</strong></>}</li>}
      </ul>
      {a.timeLimitMin && !a.inProgressAttemptId && <Alert kind="info">The timer starts as soon as you begin and keeps running if you leave. Your answers are saved automatically.</Alert>}
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {a.inProgressAttemptId
          ? <Link href={`/student/attempts/${a.inProgressAttemptId}`} className="rounded-md bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700">Resume attempt</Link>
          : (left === null || left > 0) && <Button onClick={start} busy={busy}>{a.attemptsUsed ? 'Try again' : 'Start'}</Button>}
        {a.latestAttemptId && <Link href={`/student/attempts/${a.latestAttemptId}`} className="rounded-md px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">Review last result</Link>}
      </div>
      {left === 0 && !a.inProgressAttemptId && <p className="text-sm text-slate-500">You have used all attempts for this test.</p>}
    </Card>
  );
}

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

function Criteria({ items }: { items: string[] }) {
  if (!items.length) return null;
  return <p className="text-xs text-slate-500">Marked on: {items.join(' · ')}</p>;
}

function History({ history }: { history: AssignmentSummary['history'] }) {
  if (!history.length) return null;
  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold">Your submissions</h4>
      <ul className="divide-y divide-slate-100 text-sm">
        {history.map((h) => (
          <li key={h.id} className="flex items-center justify-between py-1.5">
            <span>{date(h.submittedAt, true)}</span>
            <span className="flex items-center gap-3">{h.finalBand !== null && <strong>Band {band(h.finalBand)}</strong>}<Badge status={h.status} /><Link href={`/student/submissions/${h.id}`} className="text-indigo-700 underline">{h.status === 'GRADED' ? 'View feedback' : 'View'}</Link></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WritingPanel({ a, onChanged }: { a: AssignmentSummary; onChanged: () => void }) {
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
      {a.instructions && <p className="whitespace-pre-wrap text-sm text-slate-700">{a.instructions}</p>}
      <Criteria items={a.criteria} />
      {a.dueAt && <p className="text-xs text-slate-500">Due {date(a.dueAt, true)}</p>}
      {waiting ? <Alert kind="info">Submitted — waiting for your mentor’s feedback. You’ll be notified when it is graded.</Alert> : (
        <>
          <textarea aria-label="Your answer" rows={16} value={text} onChange={(e) => setText(e.target.value)} spellCheck
            className="w-full rounded-md px-3 py-2 text-sm leading-relaxed ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600" />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className={a.minWords && words < a.minWords ? 'text-amber-700' : 'text-slate-600'}>{words} word{words === 1 ? '' : 's'}{a.minWords ? ` (minimum ${a.minWords})` : ''}</span>
            <span aria-live="polite" className={state === 'offline' || state === 'conflict' ? 'text-red-600' : 'text-slate-500'}>
              {state === 'saved' ? 'Draft saved' : state === 'saving' ? 'Saving…' : state === 'offline' ? 'Offline — kept on this device' : 'Changed in another tab — reload'}
            </span>
          </div>
          {error && <Alert>{error}</Alert>}
          <Button onClick={() => confirm('Submit for grading? You can’t edit it afterwards.') && submit()} busy={busy} disabled={words === 0}>Submit for grading</Button>
        </>
      )}
      <History history={a.history} />
    </Card>
  );
}

function SpeakingPanel({ a, onChanged }: { a: AssignmentSummary; onChanged: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const waiting = a.current?.status === 'SUBMITTED';

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); if (url) URL.revokeObjectURL(url); }, [url]);

  function keep(b: Blob) { setBlob(b); setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(b); }); }

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); keep(new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' })); };
      mr.start(); rec.current = mr; setRecording(true); setSeconds(0);
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch { setError('We could not access your microphone. Allow microphone access, or upload a recording instead.'); }
  }
  function stop() { rec.current?.stop(); setRecording(false); if (timer.current) clearInterval(timer.current); }

  async function submit() {
    if (!blob) return;
    if (blob.size > 25 * 1024 * 1024) { setError('The recording is larger than 25 MB.'); return; }
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', blob, `answer.${blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mpeg') ? 'mp3' : blob.type.includes('wav') ? 'wav' : 'webm'}`);
      await api(`/assignments/${a.id}/submit-audio`, { method: 'POST', form: fd });
      onChanged();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Card className="space-y-3">
      <h3 className="font-semibold">Your recording</h3>
      {a.instructions && <p className="whitespace-pre-wrap text-sm text-slate-700">{a.instructions}</p>}
      <Criteria items={a.criteria} />
      {waiting ? <Alert kind="info">Submitted — waiting for your mentor’s feedback.</Alert> : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {!recording ? <Button variant="secondary" onClick={start}>● Record</Button> : <Button variant="danger" onClick={stop}>■ Stop ({Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')})</Button>}
            <label className="cursor-pointer text-sm text-indigo-700 underline">or upload a file
              <input type="file" className="sr-only" accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) keep(f); }} />
            </label>
          </div>
          {url && <audio controls src={url} className="w-full" />}
          {error && <Alert>{error}</Alert>}
          <Button onClick={() => confirm('Submit this recording for grading?') && submit()} busy={busy} disabled={!blob || recording}>Submit recording</Button>
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
