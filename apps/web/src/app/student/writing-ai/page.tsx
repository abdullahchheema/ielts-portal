'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, CardList, CardListItem, Empty, Field, Loading, PageHeader, Section, Select, Textarea, Tooltip } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';
import { planHas, usePlan } from '@/lib/plan';

interface Row { id: string; taskType: string; promptText: string; wordCount: number; status: string; submittedAt: string | null; estimatedBand: string | null }

/** Writing practice: start an essay from a prompt you paste, then open it to write and get an AI estimate. */
export default function WritingPracticePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['writing-list'], queryFn: () => api<Row[]>('/writing/responses') });
  const { data: plan } = usePlan();
  const hasAi = planHas(plan, 'ai.evaluation');
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
      {plan && !hasAi && (
        <div className="mb-6"><Alert kind="info">You can write and save essays on your current plan, but AI feedback requires the Advanced or Premium plan. <a href="/pricing" className="font-semibold underline">See plans</a>.</Alert></div>
      )}
      <Card className="mb-6 space-y-3">
        <h2 className="font-semibold text-fg">Start a new essay</h2>
        {error && <Alert>{error}</Alert>}
        <Field label="Task">{(p) => <Select {...p} value={taskType} onChange={(e) => setTaskType(e.target.value as 'TASK1' | 'TASK2')}><option value="TASK2">Task 2 (opinion or discussion)</option><option value="TASK1">Task 1 (describe a chart or process)</option></Select>}</Field>
        <Field label="Question" hint="Paste the exact question from your practice material.">{(p) => <Textarea {...p} rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />}</Field>
        <div className="flex justify-end">
          <Button onClick={start} busy={busy} disabled={prompt.trim().length < 10}>Start essay</Button>
        </div>
      </Card>

      <Section title="Your essays">
        {isLoading && <Loading />}
        {isError && <Alert>Could not load your essays.</Alert>}
        {data && (data.length === 0 ? <Empty title="No essays yet">Start one above.</Empty> : (
          <CardList>
            {data.map((r) => (
              <CardListItem key={r.id} href={`/student/writing-ai/${r.id}`}
                left={
                  <Tooltip content={r.promptText}>
                    <span className="min-w-0 truncate text-sm font-medium text-fg">{r.promptText}</span>
                  </Tooltip>
                }
                right={<span className="flex items-center gap-3 text-xs text-fg-muted">
                  <span>{r.taskType === 'TASK1' ? 'Task 1' : 'Task 2'} · {r.wordCount} words</span>
                  {r.estimatedBand && <span>AI estimate {r.estimatedBand}</span>}
                  <Badge status={r.status} />
                  <span>{date(r.submittedAt ?? null)}</span>
                </span>}
              />
            ))}
          </CardList>
        ))}
      </Section>
    </>
  );
}
