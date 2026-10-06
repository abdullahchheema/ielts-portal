'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface Mock { id: string; title: string; timeLimitMin: number | null }
interface Exam { id: string; status: string; stage: string; overallEstimate: string | null; missingSkills: string[]; createdAt: string; completedAt: string | null }

/** Full IELTS simulator: listening and reading from the library, then writing and speaking. */
export default function SimulatorPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const available = useQuery({ queryKey: ['sim-available'], queryFn: () => api<{ listening: Mock[]; reading: Mock[] }>('/simulator/available') });
  const exams = useQuery({ queryKey: ['sim-exams'], queryFn: () => api<Exam[]>('/simulator/exams') });
  const [listening, setListening] = useState('');
  const [reading, setReading] = useState('');
  const [includeSpeaking, setIncludeSpeaking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true); setError(null);
    try {
      const e = await api<{ id: string }>('/simulator/exams', { method: 'POST', body: { listeningAssessmentId: listening, readingAssessmentId: reading, includeSpeaking } });
      await qc.invalidateQueries({ queryKey: ['sim-exams'] });
      router.push(`/student/simulator/${e.id}`);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  const noMocks = available.data && available.data.listening.length === 0 && available.data.reading.length === 0;

  return (
    <>
      <PageHeader title="Full IELTS simulator" subtitle="Listening, reading, writing and speaking in order, with timed sections. Scores are estimates for planning, not official results." />
      {error && <Alert>{error}</Alert>}
      {available.isLoading && <Loading />}
      {available.isError && <Alert>Could not load mock tests.</Alert>}
      {noMocks && <Empty title="No mock tests are open yet">Your academy will open a listening and a reading mock here when they are ready.</Empty>}

      {available.data && !noMocks && (
        <Card className="mb-8 max-w-2xl space-y-4">
          <h2 className="font-semibold text-fg">Start a simulator</h2>
          <Select aria-label="Listening mock" value={listening} onChange={(e) => setListening(e.target.value)}>
            <option value="">Choose a listening mock</option>
            {available.data.listening.map((m) => <option key={m.id} value={m.id}>{m.title}{m.timeLimitMin ? ` · ${m.timeLimitMin} min` : ''}</option>)}
          </Select>
          <Select aria-label="Reading mock" value={reading} onChange={(e) => setReading(e.target.value)}>
            <option value="">Choose a reading mock</option>
            {available.data.reading.map((m) => <option key={m.id} value={m.id}>{m.title}{m.timeLimitMin ? ` · ${m.timeLimitMin} min` : ''}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={includeSpeaking} onChange={(e) => setIncludeSpeaking(e.target.checked)} /> Include the speaking section
          </label>
          <div className="flex justify-end">
            <Button onClick={start} busy={busy} disabled={!listening || !reading}>Start simulator</Button>
          </div>
          <p className="text-xs text-fg-subtle">You can only have one simulator in progress. Finish or resume it before starting another.</p>
        </Card>
      )}

      <h2 className="mb-3 font-semibold text-fg">Your simulators</h2>
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
    </>
  );
}
