'use client';

import { SkeletonTable } from '@/components/ui';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Loading, PageHeader, Select, Textarea } from '@/components/ui';
import { IeltsBadge, IeltsSummaryLike } from '@/components/IeltsSummary';
import { ApiError, api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { band, date } from '@/lib/format';

interface Detail {
  id: string; status: string; revision: number; submittedAt: string; late: boolean; wordCount: number | null; body: string | null; audioUrl: string | null; finalBand: number | null;
  assignment: { title: string; skill: string; instructions: string | null; minWords: number | null };
  rubric: { name: string; criteria: { id: string; name: string }[] } | null;
  student: { name: string; currentBand: number | null; targetBand: number | null; ielts?: IeltsSummaryLike };
  feedback: { id: string; createdAt: string; comment: string | null; finalBand: number | null; scores: { criterionId: string; criterion: string; score: number; comment: string | null }[] }[];
}

const BANDS = Array.from({ length: 19 }, (_, i) => (18 - i) / 2);
/** Same rule as the API: average to the nearest half band, .25 and .75 round up. */
const ieltsRound = (v: number[]) => (v.length ? Math.floor((v.reduce((a, b) => a + b, 0) / v.length) * 2 + 0.5 + 1e-9) / 2 : null);

export default function GradePage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: s, isLoading, isError, error } = useQuery({ queryKey: ['grade', id], queryFn: () => api<Detail>(`/mentor/submissions/${id}`) });
  const [scores, setScores] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Start a regrade from the latest grading.
  useEffect(() => {
    if (!s?.feedback[0]) return;
    const f = s.feedback[0];
    setScores(Object.fromEntries(f.scores.map((x) => [x.criterionId, String(x.score)])));
    setNotes(Object.fromEntries(f.scores.map((x) => [x.criterionId, x.comment ?? ''])));
    setComment(f.comment ?? '');
  }, [s?.id, s?.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <SkeletonTable rows={6} cols={5} />;
  if (isError || !s) return <Alert>{errorMessage(error)}</Alert>;
  const criteria = s.rubric?.criteria ?? [];
  const values = criteria.map((c) => scores[c.id]).filter((v) => v !== undefined && v !== '').map(Number);
  const preview = values.length === criteria.length ? ieltsRound(values) : null;

  async function submit() {
    setBusy(true); setMsg(null);
    try {
      await api(`/mentor/submissions/${id}/grade`, { method: 'POST', body: {
        revision: s!.revision, comment: comment || undefined,
        scores: criteria.map((c) => ({ criterionId: c.id, score: Number(scores[c.id]), comment: notes[c.id] || undefined })),
      } });
      setMsg({ kind: 'success', text: 'Grade saved and the student has been notified.' });
      await qc.invalidateQueries({ queryKey: ['grade', id] }); qc.invalidateQueries({ queryKey: ['grading-queue'] });
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof ApiError && e.code === 'CONFLICT' ? 'Someone else graded this while you were working. Reload to see their grade.' : errorMessage(e) });
    } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title={s.assignment.title} subtitle={`${s.student.name} · submitted ${date(s.submittedAt, true)}${s.late ? ' (late)' : ''}`} actions={<><Badge status={s.status} /><Link href="/teacher/grading" className="text-sm text-primary underline">← Queue</Link></>} />
      {msg && <div className="mb-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-4">
          <Card>
            <p className="mb-2 flex items-center gap-2 text-xs text-fg-muted">Student level: {band(s.student.currentBand)} → target {band(s.student.targetBand)}{s.wordCount ? ` · ${s.wordCount} words${s.assignment.minWords ? ` (min ${s.assignment.minWords})` : ''}` : ''} <IeltsBadge ielts={s.student.ielts} /></p>
            {s.assignment.instructions && <details className="mb-3 text-sm"><summary className="cursor-pointer text-primary">Task instructions</summary><p className="mt-1 whitespace-pre-wrap text-fg">{s.assignment.instructions}</p></details>}
            {s.body && <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{s.body}</p>}
            {s.audioUrl && <audio controls className="w-full" src={s.audioUrl} />}
          </Card>
          {s.feedback.length > 0 && (
            <Card><h2 className="mb-2 font-semibold">Grading history</h2>
              <ul className="space-y-2 text-sm">{s.feedback.map((f) => <li key={f.id}><strong>Band {band(f.finalBand)}</strong> <span className="text-fg-muted">· {date(f.createdAt, true)}</span>{f.comment && <p className="text-fg">{f.comment}</p>}</li>)}</ul>
            </Card>
          )}
        </div>

        <Card className="h-fit space-y-4 lg:sticky lg:top-4">
          <h2 className="font-semibold">{s.rubric?.name ?? 'Rubric'}</h2>
          {criteria.length === 0 && <Alert>This task has no rubric configured.</Alert>}
          {criteria.map((c) => (
            <div key={c.id} className="space-y-1.5">
              <Field label={c.name}>{(p) => <Select {...p} value={scores[c.id] ?? ''} onChange={(e) => setScores({ ...scores, [c.id]: e.target.value })}><option value="">Select band…</option>{BANDS.map((b) => <option key={b} value={b}>{b.toFixed(1)}</option>)}</Select>}</Field>
              <Textarea aria-label={`Note on ${c.name}`} rows={2} placeholder="Optional note" value={notes[c.id] ?? ''} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} />
            </div>
          ))}
          <div className="rounded-md bg-primary-soft px-3 py-2 text-sm" aria-live="polite">Overall band: <strong className="text-lg text-indigo-800">{preview === null ? '—' : preview.toFixed(1)}</strong></div>
          <Field label="Overall comment for the student">{(p) => <Textarea {...p} rows={4} value={comment} onChange={(e) => setComment(e.target.value)} />}</Field>
          <Button onClick={submit} busy={busy} disabled={preview === null} className="w-full">{s.status === 'GRADED' ? 'Save new grade' : 'Submit grade'}</Button>
        </Card>
      </div>
    </>
  );
}
