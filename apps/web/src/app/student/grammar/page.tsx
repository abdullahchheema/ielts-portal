'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Card, Empty, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';

interface Row {
  code: string; label: string; thisMonth: number; lastMonth: number;
  trend: { direction: 'UP' | 'DOWN' | 'SAME' | 'NEW'; percent: number | null };
  examples: { excerpt: string; correction: string | null; at: string }[];
}
interface Dashboard { rows: Row[]; total: number; note: string }

const ARROW = { UP: '↑', DOWN: '↓', SAME: '→', NEW: '•' } as const;

/** Recurring grammar issues from your writing, with month-on-month change and examples. */
export default function GrammarPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['grammar'], queryFn: () => api<Dashboard>('/me/grammar') });
  return (
    <>
      <PageHeader title="Grammar tracker" subtitle="The mistakes that come back most often, and whether they are getting better." />
      {isLoading && <Loading />}
      {isError && <Alert>Could not load your grammar history.</Alert>}
      {data && data.rows.length === 0 && <Empty title="No grammar notes yet">Submit an essay for feedback to start tracking.</Empty>}
      {data && data.rows.length > 0 && (
        <div className="space-y-4">
          {data.rows.map((r) => (
            <Card key={r.code} className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="font-semibold text-fg">{r.label}</p>
                <p className="text-sm tabular-nums text-fg-muted">
                  {r.thisMonth} this month
                  {r.trend.direction !== 'NEW' && r.trend.percent !== null && <span className={r.trend.direction === 'DOWN' ? ' text-success' : r.trend.direction === 'UP' ? ' text-danger' : ''}> {ARROW[r.trend.direction]} {r.trend.percent}%</span>}
                </p>
              </div>
              {r.examples.length > 0 && (
                <ul className="space-y-2 text-sm">
                  {r.examples.map((e, i) => (
                    <li key={i}><span className="text-fg-muted line-through">{e.excerpt}</span>{e.correction && <span className="text-success"> → {e.correction}</span>}</li>
                  ))}
                </ul>
              )}
              <Link href="/student/writing-ai" className="text-sm font-medium text-primary hover:underline">Practise with a writing task</Link>
            </Card>
          ))}
          <p className="text-xs text-fg-subtle">{data.note}</p>
        </div>
      )}
    </>
  );
}
