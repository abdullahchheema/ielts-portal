'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Empty, Field, Loading, PageHeader, Section, Select, Table, Td, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

type AccessStatus = 'ACTIVATED' | 'APPROVED' | 'EXPIRED' | 'PENDING' | 'DECLINED' | 'NONE';
interface Access { canAttempt: boolean; status: AccessStatus; availableFrom: string | null; availableUntil: string | null; instructions: string | null; requestId: string | null; decisionNote: string | null }
interface Mock { id: string; title: string; timeLimitMin: number | null; access: Access }
interface MockExam { id: string; title: string; access: Access }
interface Exam { id: string; status: string; stage: string; overallEstimate: string | null; missingSkills: string[]; createdAt: string; completedAt: string | null }

const STATUS_TONE: Record<AccessStatus, 'green' | 'amber' | 'red' | 'slate'> = {
  ACTIVATED: 'green', APPROVED: 'green', EXPIRED: 'slate', PENDING: 'amber', DECLINED: 'red', NONE: 'slate',
};
const STATUS_LABEL: Record<AccessStatus, string> = {
  ACTIVATED: 'Open for your batch', APPROVED: 'Access approved', EXPIRED: 'Approval window ended',
  PENDING: 'Request pending', DECLINED: 'Request declined', NONE: 'Not requested',
};

function RequestRow({ m, requestUrl }: { m: { id: string; title: string; timeLimitMin?: number | null; access: Access }; requestUrl: string }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request() {
    setBusy(true); setError(null);
    try {
      await api(requestUrl, { method: 'POST', body: { reason: reason.trim() || undefined } });
      await qc.invalidateQueries({ queryKey: ['sim-available'] });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-fg">{m.title}{m.timeLimitMin ? ` · ${m.timeLimitMin} min` : ''}</span>
        <Badge status={m.access.status} text={STATUS_LABEL[m.access.status]} tone={STATUS_TONE[m.access.status]} />
      </div>
      {m.access.status === 'DECLINED' && m.access.decisionNote && <p className="text-fg-subtle">Declined: {m.access.decisionNote}</p>}
      {m.access.status === 'PENDING' ? (
        <p className="text-fg-subtle">Waiting for a teacher or admin to review your request.</p>
      ) : !m.access.canAttempt && (
        open ? (
          <div className="mt-1 flex flex-col gap-2">
            <Textarea rows={2} placeholder="Optional note for your reviewer" value={reason} onChange={(e) => setReason(e.target.value)} />
            {error && <Alert>{error}</Alert>}
            <div className="flex gap-2"><Button size="sm" busy={busy} onClick={request}>Send request</Button><Button size="sm" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button></div>
          </div>
        ) : <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Request access</Button>
      )}
    </div>
  );
}

/** Full IELTS simulator: listening and reading from the library, then writing and speaking. */
export default function SimulatorPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const available = useQuery({ queryKey: ['sim-available'], queryFn: () => api<{ listening: Mock[]; reading: Mock[]; mockExams: MockExam[] }>('/simulator/available') });
  const exams = useQuery({ queryKey: ['sim-exams'], queryFn: () => api<Exam[]>('/simulator/exams') });
  const [listening, setListening] = useState('');
  const [reading, setReading] = useState('');
  const [includeSpeaking, setIncludeSpeaking] = useState(true);
  const [mockExamId, setMockExamId] = useState('');
  const [includeSpeakingBundle, setIncludeSpeakingBundle] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bundleBusy, setBundleBusy] = useState(false);

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
  const mockExamsReady = mockExams.filter((m) => m.access.canAttempt);
  const noMocks = available.data && available.data.listening.length === 0 && available.data.reading.length === 0 && mockExams.length === 0;
  const listeningReady = available.data?.listening.filter((m) => m.access.canAttempt) ?? [];
  const readingReady = available.data?.reading.filter((m) => m.access.canAttempt) ?? [];

  return (
    <>
      <PageHeader title="Full IELTS simulator" subtitle="Listening, reading, writing and speaking in order, with timed sections. Scores are estimates for planning, not official results." />
      {error && <Alert>{error}</Alert>}
      {available.isLoading && <Loading />}
      {available.isError && <Alert>Could not load mock tests.</Alert>}
      {noMocks && <Empty title="No mock tests are open yet">Your academy will open a listening and a reading mock here when they are ready.</Empty>}

      {available.data && mockExams.length > 0 && (
        <Section title="Mock exams" className="mb-8">
          <div className="grid gap-2 sm:grid-cols-2">{mockExams.map((m) => <RequestRow key={m.id} m={m} requestUrl={`/mock-exams/${m.id}/access-requests`} />)}</div>
        </Section>
      )}

      {available.data && mockExamsReady.length > 0 && (
        <Card className="mb-8 max-w-lg space-y-4">
          <h2 className="font-semibold text-fg">Start a mock exam</h2>
          <Field label="Mock exam">
            {(p) => (
              <Select {...p} value={mockExamId} onChange={(e) => setMockExamId(e.target.value)}>
                <option value="">Choose a mock exam</option>
                {mockExamsReady.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </Select>
            )}
          </Field>
          <Checkbox label="Include the speaking section" checked={includeSpeakingBundle} onChange={(e) => setIncludeSpeakingBundle(e.target.checked)} />
          <div className="flex justify-end">
            <Button onClick={startBundle} busy={bundleBusy} disabled={!mockExamId}>Start mock exam</Button>
          </div>
          <p className="text-xs text-fg-subtle">You can only have one simulator in progress. Finish or resume it before starting another.</p>
        </Card>
      )}

      {(available.data?.listening.length ?? 0) > 0 || (available.data?.reading.length ?? 0) > 0 ? (
        <div className="mb-8 grid gap-4 md:grid-cols-2">
          <Section title="Listening mocks">
            <div className="space-y-2">{available.data!.listening.map((m) => <RequestRow key={m.id} m={m} requestUrl={`/assessments/${m.id}/mock-access-requests`} />)}</div>
          </Section>
          <Section title="Reading mocks">
            <div className="space-y-2">{available.data!.reading.map((m) => <RequestRow key={m.id} m={m} requestUrl={`/assessments/${m.id}/mock-access-requests`} />)}</div>
          </Section>
        </div>
      ) : null}

      {available.data && !noMocks && (available.data.listening.length > 0 || available.data.reading.length > 0) && (listeningReady.length === 0 || readingReady.length === 0) && (
        <Alert kind="info">You need access to at least one listening mock and one reading mock before you can start the simulator.</Alert>
      )}

      {available.data && listeningReady.length > 0 && readingReady.length > 0 && (
        <Card className="mb-8 max-w-2xl space-y-4">
          <h2 className="font-semibold text-fg">Start a simulator</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Listening mock">
              {(p) => (
                <Select {...p} value={listening} onChange={(e) => setListening(e.target.value)}>
                  <option value="">Choose a listening mock</option>
                  {listeningReady.map((m) => <option key={m.id} value={m.id}>{m.title}{m.timeLimitMin ? ` · ${m.timeLimitMin} min` : ''}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Reading mock">
              {(p) => (
                <Select {...p} value={reading} onChange={(e) => setReading(e.target.value)}>
                  <option value="">Choose a reading mock</option>
                  {readingReady.map((m) => <option key={m.id} value={m.id}>{m.title}{m.timeLimitMin ? ` · ${m.timeLimitMin} min` : ''}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <Checkbox label="Include the speaking section" checked={includeSpeaking} onChange={(e) => setIncludeSpeaking(e.target.checked)} />
          <div className="flex justify-end">
            <Button onClick={start} busy={busy} disabled={!listening || !reading}>Start simulator</Button>
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
