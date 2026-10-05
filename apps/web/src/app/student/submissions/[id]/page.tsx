'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { Alert, Badge, Card, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { band, date } from '@/lib/format';

export interface SubmissionView {
  id: string; status: string; submittedAt: string; late: boolean; wordCount: number | null; body: string | null; audioUrl: string | null; finalBand: number | null;
  assignment: { title: string; skill: string; instructions: string | null };
  feedback: { id: string; createdAt: string; comment: string | null; finalBand: number | null; scores: { criterion: string; score: number; comment: string | null }[] }[];
}

export default function SubmissionPage() {
  const { id } = useParams<{ id: string }>();
  const { data: s, isLoading, isError } = useQuery({ queryKey: ['submission', id], queryFn: () => api<SubmissionView>(`/submissions/${id}`) });
  if (isLoading) return <Loading />;
  if (isError || !s) return <Alert>We could not find that submission.</Alert>;
  const [latest, ...older] = s.feedback;

  return (
    <>
      <PageHeader title={s.assignment.title} subtitle={`Submitted ${date(s.submittedAt, true)}${s.late ? ' · late' : ''}${s.wordCount ? ` · ${s.wordCount} words` : ''}`} actions={<Badge status={s.status} />} />
      {latest ? (
        <Card className="mb-6 space-y-4">
          <div className="flex items-baseline justify-between"><h2 className="text-lg font-semibold">Teacher feedback</h2><p className="text-3xl font-semibold text-primary">Band {band(latest.finalBand)}</p></div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-fg-muted"><th className="py-1 font-medium">Criterion</th><th className="w-20 text-right font-medium">Band</th></tr></thead>
            <tbody>{latest.scores.map((c) => (
              <tr key={c.criterion} className="border-t border-border align-top"><td className="py-2">{c.criterion}{c.comment && <p className="text-fg-muted">{c.comment}</p>}</td><td className="py-2 text-right font-semibold">{band(c.score)}</td></tr>
            ))}</tbody>
          </table>
          {latest.comment && <div><h3 className="mb-1 text-sm font-semibold">Overall comment</h3><p className="whitespace-pre-wrap text-sm text-fg">{latest.comment}</p></div>}
          {older.length > 0 && (
            <details className="text-sm"><summary className="cursor-pointer text-primary">Earlier gradings ({older.length})</summary>
              <ul className="mt-2 space-y-1">{older.map((f) => <li key={f.id}>{date(f.createdAt, true)} — Band {band(f.finalBand)}{f.comment ? ` — ${f.comment}` : ''}</li>)}</ul>
            </details>
          )}
        </Card>
      ) : <div className="mb-6"><Alert kind="info">Your mentor hasn’t graded this yet. You’ll get a notification when it’s ready.</Alert></div>}

      <Card>
        <h2 className="mb-2 font-semibold">Your submission</h2>
        {s.body && <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{s.body}</p>}
        {s.audioUrl && <audio controls className="w-full" src={s.audioUrl} />}
      </Card>
    </>
  );
}
