'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Button, Card, Empty, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface MockAttempt { id: string; status: string; overallEstimate: string | null; completedAt: string | null }
interface MockExamEntry {
  id: string; title: string; createdAt: string;
  listeningModuleTitle: string; readingModuleTitle: string;
  attempts: MockAttempt[]; inProgressAttemptId: string | null;
}
interface Available { listening: unknown[]; reading: unknown[]; mockExams: MockExamEntry[] }

export default function MockTestsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['mock-tests'],
    queryFn: () => api<Available>('/simulator/available'),
  });

  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>Could not load mock tests.</Alert>;

  const mocks = data.mockExams;

  return (
    <>
      <PageHeader title="Mock Tests" subtitle="Full timed IELTS simulator — Listening, Reading, Writing, and Speaking. Retake as many times as you like." />
      {mocks.length === 0 ? <Empty>No mock tests are available yet.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2">
          {mocks.map((m) => <MockCard key={m.id} mock={m} />)}
        </div>
      )}
    </>
  );
}

function MockCard({ mock }: { mock: MockExamEntry }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completedAttempts = mock.attempts.filter((a) => a.status === 'COMPLETED');

  async function startNew() {
    setBusy(true); setError(null);
    try {
      const result = await api<{ id: string }>('/simulator/exams/from-mock-exam', { method: 'POST', body: { mockExamId: mock.id, includeSpeaking: true } });
      await qc.invalidateQueries({ queryKey: ['mock-tests'] });
      window.location.href = `/student/simulator/${result.id}`;
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  }

  return (
    <Card className="space-y-3">
      <h3 className="font-semibold text-fg">{mock.title}</h3>
      <p className="text-sm text-fg-muted">
        Listening: {mock.listeningModuleTitle} · Reading: {mock.readingModuleTitle}
      </p>
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {mock.inProgressAttemptId ? (
          <Link href={`/student/simulator/${mock.inProgressAttemptId}`}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover">
            Resume
          </Link>
        ) : null}
        <Button variant={mock.inProgressAttemptId ? 'secondary' : 'primary'} busy={busy} onClick={startNew}>
          {completedAttempts.length > 0 ? 'Retake' : 'Start'}
        </Button>
      </div>
      {completedAttempts.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-xs font-medium text-fg-muted uppercase tracking-wide">Past attempts</p>
          <ul className="space-y-1">
            {completedAttempts.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-center justify-between text-sm">
                <Link href={`/student/simulator/${a.id}`} className="text-primary hover:underline">
                  {date(a.completedAt, true)}
                </Link>
                <span className="tabular-nums text-fg-muted">
                  {a.overallEstimate ? `Band ${a.overallEstimate}` : 'No estimate'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
