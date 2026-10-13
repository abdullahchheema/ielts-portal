'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Badge, Card, Empty, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { date, label } from '@/lib/format';

type Kind = 'WEAK_SKILL' | 'REVIEW_DUE' | 'DECLINING_TREND';
interface Insight {
  kind: Kind; skillKey: string; module: string | null; accuracyPercent: number | null; sampleSize: number;
  earlierAccuracyPercent?: number; recentAccuracyPercent?: number; periodStart: string | null; periodEnd: string | null;
}

const KIND_LABEL: Record<Kind, string> = { WEAK_SKILL: 'Needs work', REVIEW_DUE: 'Due for review', DECLINING_TREND: 'Accuracy dropping' };
const KIND_TONE: Record<Kind, 'red' | 'amber' | 'blue'> = { WEAK_SKILL: 'red', REVIEW_DUE: 'amber', DECLINING_TREND: 'blue' };
const MODULE_HREF: Record<string, string> = { LISTENING: '/student/listening', READING: '/student/reading', WRITING: '/student/writing', SPEAKING: '/student/speaking' };

function body(i: Insight): string {
  if (i.kind === 'WEAK_SKILL') return `Accuracy is ${i.accuracyPercent}% across ${i.sampleSize} questions — well below the level needed to call this skill solid.`;
  if (i.kind === 'REVIEW_DUE') return `This skill was previously strong, but it's been a while since you last practised it — accuracy was ${i.accuracyPercent}% last time.`;
  return `Accuracy went from ${i.earlierAccuracyPercent}% to ${i.recentAccuracyPercent}% across your last ${i.sampleSize} questions on this skill.`;
}

export default function InsightsPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['insights'], queryFn: () => api<Insight[]>('/me/insights') });

  return (
    <>
      <PageHeader title="Insights" subtitle="Progress shows where you are. Insights explains why, with the evidence behind each finding — and says nothing where there isn't enough data yet." />
      {isLoading && <Loading />}
      {isError && <Alert>Could not load insights.</Alert>}
      {data && (data.length === 0 ? (
        <Empty>Not enough practice history yet to find a pattern. Keep working through your course and mock tests — insights appear once there's real evidence behind them.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((i, idx) => (
            <Card key={`${i.skillKey}-${i.kind}-${idx}`} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge status={i.kind} tone={KIND_TONE[i.kind]} text={KIND_LABEL[i.kind]} />
                <h3 className="font-semibold text-slate-900">{label(i.skillKey)}</h3>
              </div>
              <p className="text-sm text-slate-600">{body(i)}</p>
              {i.periodStart && i.periodEnd && <p className="text-xs text-slate-400">Evidence from {date(i.periodStart)} to {date(i.periodEnd)}</p>}
              {i.module && MODULE_HREF[i.module] && (
                <Link href={MODULE_HREF[i.module]} className="inline-block text-sm font-medium text-indigo-700 hover:underline">
                  Practice {label(i.module)} →
                </Link>
              )}
            </Card>
          ))}
        </div>
      ))}
    </>
  );
}
