'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Field, Loading, PageHeader, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface Row { id: string; taskType: string; promptText: string; wordCount: number; status: string; submittedAt: string | null; estimatedBand: string | null }

/** Writing practice: start an essay from a prompt you paste, then open it to write and get an AI estimate. */
export default function WritingPracticePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['writing-list'], queryFn: () => api<Row[]>('/writing/responses') });
  const [taskType, setTaskType] = useState<'TASK1' | 'TASK2'>('TASK2');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ id: string }>('/writing/responses', { method: 'POST', body: { taskType, promptText: prompt.trim() } });
      await qc.invalidateQueries({ queryKey: ['writing-list'] });
      router.push(`/student/writing-ai/${r.id}`);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Writing practice" subtitle="Write an essay, submit it, and see an AI estimate with feedback. The estimate is guidance only, not an official IELTS result." />
      <Card className="mb-6 space-y-3">
        <h2 className="font-semibold text-fg">Start a new essay</h2>
        {error && <Alert>{error}</Alert>}
        <Field label="Task">{(p) => <Select {...p} value={taskType} onChange={(e) => setTaskType(e.target.value as 'TASK1' | 'TASK2')}><option value="TASK2">Task 2 (opinion or discussion)</option><option value="TASK1">Task 1 (describe a chart or process)</option></Select>}</Field>
        <Field label="Question" hint="Paste the exact question from your practice material.">{(p) => <Textarea {...p} rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />}</Field>
        <div className="flex justify-end">
          <Button onClick={start} busy={busy} disabled={prompt.trim().length < 10}>Start essay</Button>
        </div>
      </Card>

      <h2 className="mb-3 font-semibold text-fg">Your essays</h2>
      {isLoading && <Loading />}
      {isError && <Alert>Could not load your essays.</Alert>}
      {data && (data.length === 0 ? <Empty title="No essays yet">Start one above.</Empty> : (
        <ul className="space-y-2">
          {data.map((r) => (
            <li key={r.id}>
              <Link href={`/student/writing-ai/${r.id}`} className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3 hover:border-primary sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0 truncate text-sm font-medium text-fg">{r.promptText}</span>
                <span className="flex items-center gap-3 text-xs text-fg-muted">
                  <span>{r.taskType === 'TASK1' ? 'Task 1' : 'Task 2'} · {r.wordCount} words</span>
                  {r.estimatedBand && <span>AI estimate {r.estimatedBand}</span>}
                  <Badge status={r.status} />
                  <span>{date(r.submittedAt ?? null)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ))}
    </>
  );
}
