'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Empty, Field, Loading, PageHeader, Section, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

// Real response shapes from SimulatorService.available() and SimulatorService.list().
// The old Access / RequestRow infrastructure was removed when access gating was turned off.
interface MockItem { id: string; title: string; timeLimitMin: number | null }
interface MockAttempt { id: string; status: string; overallEstimate: string | null; completedAt: string | null }
interface MockExam {
  id: string; title: string;
  listeningModuleTitle: string; readingModuleTitle: string;
  attempts: MockAttempt[]; inProgressAttemptId: string | null;
}
interface Exam { id: string; status: string; stage: string; overallEstimate: string | null; missingSkills: string[]; createdAt: string; completedAt: string | null }

/** Full IELTS simulator: listening and reading from the library, then writing and speaking. */
export default function SimulatorPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const available = useQuery({ queryKey: ['sim-available'], queryFn: () => api<{ listening: MockItem[]; reading: MockItem[]; mockExams: MockExam[] }>('/simulator/available') });
  const exams = useQuery({ queryKey: ['sim-exams'], queryFn: () => api<Exam[]>('/simulator/exams') });
  const [listening, setListening] = useState('');
  const [reading, setReading] = useState('');
  const [includeSpeaking, setIncludeSpeaking] = useState(true);
  const [mockExamId, setMockExamId] = useState('');
  const [includeSpeakingBundle, setIncludeSpeakingBundle] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bundleBusy, setBundleBusy] = useState(false);

  /** True if the student already has a running attempt — the partial unique index only allows one. */
  const hasInProgress = exams.data?.some((x) => x.status === 'IN_PROGRESS') ?? false;
  const inProgressId = exams.data?.find((x) => x.status === 'IN_PROGRESS')?.id ?? null;

  async function start() {
    setBusy(true); setError(null);
    try {
      const e = await api<{ id: string }>('/simulator/exams', { method: 'POST', body: { listeningAssessmentId: listening, readingAssessmentId: reading, includeSpeaking } });
      await qc.invalidateQueries({ queryKey: ['sim-exams'] });
      router.push(`/student/simulator/${e.id}`);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function startBundle() {
    setBundleBusy(true); setError(null);
    try {
      const e = await api<{ id: string }>('/simulator/exams/from-mock-exam', { method: 'POST', body: { mockExamId, includeSpeaking: includeSpeakingBundle } });
      await qc.invalidateQueries({ queryKey: ['sim-exams'] });
      router.push(`/student/simulator/${e.id}`);
    } catch (e) { setError(errorMessage(e)); } finally { setBundleBusy(false); }
  }

  const mockExams = available.data?.mockExams ?? [];
  const listeningMocks = available.data?.listening ?? [];
  const readingMocks = available.data?.reading ?? [];
  const noMocks = available.data && listeningMocks.length === 0 && readingMocks.length === 0 && mockExams.length === 0;

  return (
    <>
      <PageHeader title="Full IELTS simulator" subtitle="Listening, reading, writing and speaking in order, with timed sections. Scores are estimates for planning, not official results." />
      {error && <Alert>{error}</Alert>}
      {available.isLoading && <Loading />}
      {available.isError && <Alert>Could not load mock tests.</Alert>}
      {noMocks && <Empty title="No mock tests are open yet">Your academy will open a listening and a reading mock here when they are ready.</Empty>}

      {hasInProgress && inProgressId && (
        <Alert kind="info" className="mb-6">
          You have a simulator in progress.{' '}
          <Link href={`/student/simulator/${inProgressId}`} className="font-medium underline">Resume it →</Link>
        </Alert>
      )}

      {mockExams.length > 0 && (
        <Section title="Mock exams" className="mb-8">
          <div className="grid gap-2 sm:grid-cols-2">
            {mockExams.map((m) => (
              <div key={m.id} className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
                <p className="font-medium text-fg">{m.title}</p>
                <p className="text-xs text-fg-muted">{m.listeningModuleTitle} · {m.readingModuleTitle}</p>
                {m.inProgressAttemptId && (
                  <Link href={`/student/simulator/${m.inProgressAttemptId}`} className="mt-1 self-start text-sm text-primary hover:underline">
                    Resume →
                  </Link>
                )}
                {m.attempts.filter((a) => a.status === 'COMPLETED').map((a) => (
                  <Link key={a.id} href={`/student/simulator/${a.id}`} className="text-xs text-fg-muted hover:underline">
                    {a.completedAt ? date(a.completedAt) : 'Completed'}{a.overallEstimate ? ` · Band ${a.overallEstimate}` : ''}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </Section>
      )}

      {mockExams.length > 0 && (
        <Card className="mb-8 max-w-lg space-y-4">
          <h2 className="font-semibold text-fg">Start a mock exam</h2>
          <Field label="Mock exam">
            {(p) => (
              <Select {...p} value={mockExamId} onChange={(e) => setMockExamId(e.target.value)}>
                <option value="">Choose a mock exam</option>
                {mockExams.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </Select>
            )}
          </Field>
          <Checkbox label="Include the speaking section" checked={includeSpeakingBundle} onChange={(e) => setIncludeSpeakingBundle(e.target.checked)} />
          <div className="flex justify-end">
            <Button onClick={startBundle} busy={bundleBusy} disabled={!mockExamId || hasInProgress}>Start mock exam</Button>
          </div>
          <p className="text-xs text-fg-subtle">You can only have one simulator in progress. Finish or resume it before starting another.</p>
        </Card>
      )}

      {(listeningMocks.length > 0 || readingMocks.length > 0) && (
        <Card className="mb-8 max-w-2xl space-y-4">
          <h2 className="font-semibold text-fg">Start a simulator</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Listening mock">
              {(p) => (
                <Select {...p} value={listening} onChange={(e) => setListening(e.target.value)}>
                  <option value="">Choose a listening mock</option>
                  {listeningMocks.map((m) => <option key={m.id} value={m.id}>{m.title}{m.timeLimitMin ? ` · ${m.timeLimitMin} min` : ''}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Reading mock">
              {(p) => (
                <Select {...p} value={reading} onChange={(e) => setReading(e.target.value)}>
                  <option value="">Choose a reading mock</option>
                  {readingMocks.map((m) => <option key={m.id} value={m.id}>{m.title}{m.timeLimitMin ? ` · ${m.timeLimitMin} min` : ''}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <Checkbox label="Include the speaking section" checked={includeSpeaking} onChange={(e) => setIncludeSpeaking(e.target.checked)} />
          <div className="flex justify-end">
            <Button onClick={start} busy={busy} disabled={!listening || !reading || hasInProgress}>Start simulator</Button>
          </div>
          <p className="text-xs text-fg-subtle">You can only have one simulator in progress. Finish or resume it before starting another.</p>
        </Card>
      )}

      <Section title="Your simulators">
        {exams.isLoading && <Loading />}
        {exams.data && (exams.data.length === 0 ? <Empty title="No simulators yet" /> : (
          <Table head={['Started', 'Status', 'Stage', 'Overall (estimate)', 'Not assessed', '']}>
            {exams.data.map((x) => (
              <tr key={x.id}>
                <Td>{date(x.createdAt)}</Td>
                <Td><Badge status={x.status} /></Td>
                <Td>{x.stage.toLowerCase()}</Td>
                <Td>{x.overallEstimate ?? '—'}</Td>
                <Td>{x.missingSkills.length ? x.missingSkills.join(', ').toLowerCase() : '—'}</Td>
                <Td><Link href={`/student/simulator/${x.id}`} className="text-primary hover:underline">Open</Link></Td>
              </tr>
            ))}
          </Table>
        ))}
      </Section>
    </>
  );
}
