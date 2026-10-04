'use client';

import { SkeletonTable } from '@/components/ui';

import { useQuery } from '@tanstack/react-query';
import { Alert, Empty, Loading, PageHeader } from '@/components/ui';
import { AssessmentCard } from '@/components/LessonExtras';
import { api } from '@/lib/api';

interface Diag { id: string; title: string; skill: string | null; timeLimitMin: number | null; maxAttempts: number | null; attemptsUsed: number; inProgressAttemptId: string | null; latestAttemptId: string | null; latestBand: number | null }

export default function DiagnosticPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['diagnostics'], queryFn: () => api<Diag[]>('/me/diagnostics') });
  if (isLoading) return <SkeletonTable rows={6} cols={5} />;
  if (isError || !data) return <Alert>Could not load the diagnostic tests.</Alert>;
  return (
    <>
      <PageHeader title="Diagnostic tests" subtitle="Check your current level. Results appear in your progress page." />
      {data.length === 0 ? <Empty>No diagnostic tests are available yet.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((d) => (
            <AssessmentCard key={d.id} a={{ id: d.id, title: d.title, type: 'DIAGNOSTIC', skill: d.skill, timeLimitMin: d.timeLimitMin, maxAttempts: d.maxAttempts, passPercent: 0, attemptsUsed: d.attemptsUsed, inProgressAttemptId: d.inProgressAttemptId, latestAttemptId: d.latestAttemptId, bestPercent: null, bestBand: d.latestBand }} />
          ))}
        </div>
      )}
    </>
  );
}
