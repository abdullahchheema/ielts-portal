'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Card, Empty, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date, label } from '@/lib/format';

interface GrammarCategory {
  category: string; count: number; resolvedCount: number;
  recent: { id: string; excerpt: string | null; note: string | null; submissionId: string | null; resolvedAt: string | null; createdAt: string }[];
}
interface GrammarResponse { total: number; categories: GrammarCategory[] }

export default function GrammarTrackerPage() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['grammar-issues'], queryFn: () => api<GrammarResponse>('/me/grammar-issues') });

  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>{errorMessage(error)}</Alert>;

  return (
    <>
      <PageHeader title="Grammar Tracker" subtitle="Recurring grammar issues identified in your reviewed writing, with recommended practice." />
      {!data.total ? (
        <Empty>No grammar issues have been recorded yet. As your teacher reviews your writing submissions, recurring issues will appear here with examples from your own work.</Empty>
      ) : (
        <div className="space-y-4">
          {data.categories.map((c) => (
            <Card key={c.category}>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">{label(c.category)}</h2>
                <Badge status={c.resolvedCount === c.count ? 'RESOLVED' : 'OPEN'} tone={c.resolvedCount === c.count ? 'green' : 'amber'} text={`${c.count - c.resolvedCount} open · ${c.resolvedCount} resolved`} />
              </div>
              <ul className="mt-2 divide-y divide-slate-100">
                {c.recent.map((r) => (
                  <li key={r.id} className="py-2 text-sm">
                    {r.excerpt && <p className="text-slate-800">&ldquo;{r.excerpt}&rdquo;</p>}
                    {r.note && <p className="mt-0.5 text-slate-600">{r.note}</p>}
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                      <span>{date(r.createdAt)}</span>
                      {r.resolvedAt && <span className="text-green-600">Resolved</span>}
                      {r.submissionId && <Link href={`/student/submissions/${r.submissionId}`} className="text-indigo-700 hover:underline">View submission</Link>}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
