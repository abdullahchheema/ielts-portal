'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Empty, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { date } from '@/lib/format';

interface Item { id: string; taskType: string; wordCount: number; createdAt: string; aiBand: string | null; grammarIssues: number }
interface Side { id: string; taskType: string; createdAt: string; wordCount: number; aiBand: string | null; grammarIssues: number; vocabularyIssues: number; coherenceIssues: number; taskIssues: number; repeatedWords: number; weakPhrases: number; vocabularyRange: number | null; paragraphs: number | null }

/** Your essays over time, and a side-by-side comparison of any two. Stored evaluations are never re-analysed. */
export default function WritingHistoryPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['writing-history'], queryFn: () => api<Item[]>('/writing/history') });
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [cmp, setCmp] = useState<{ a: Side; b: Side; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function compare() {
    setBusy(true); setError(null);
    try { setCmp(await api<{ a: Side; b: Side; note: string }>(`/writing/compare?a=${a}&b=${b}`)); }
    catch { setError('Choose two different essays to compare.'); } finally { setBusy(false); }
  }

  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>Could not load your writing history.</Alert>;
  const max = Math.max(9, ...data.map((d) => Number(d.aiBand ?? 0)));

  return (
    <>
      <PageHeader title="Writing history" subtitle="Your evaluated essays, oldest first. AI estimates are guidance, not official IELTS results." />
      {data.length === 0 ? <Empty title="No evaluated essays yet">Submit an essay in writing practice to start your history.</Empty> : (
        <div className="space-y-8">
          <Card className="space-y-3">
            <h2 className="font-semibold text-fg">AI estimate over time</h2>
            <ol className="flex h-40 items-end gap-2" aria-label="AI estimates over time">
              {data.map((d) => {
                const v = Number(d.aiBand ?? 0);
                return (
                  <li key={d.id} className="flex flex-1 flex-col items-center gap-1" title={`${date(d.createdAt)} · AI estimate ${d.aiBand ?? '—'}`}>
                    <span className="text-xs tabular-nums text-fg-muted">{d.aiBand ?? '—'}</span>
                    <span className="block w-full max-w-10 rounded-t bg-primary" style={{ height: `${(v / max) * 100}%`, minHeight: v ? 4 : 0 }} />
                    <span className="text-[10px] text-fg-subtle">{date(d.createdAt)}</span>
                  </li>
                );
              })}
            </ol>
          </Card>

          <Card className="space-y-3">
            <h2 className="font-semibold text-fg">Compare two essays</h2>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Select aria-label="First essay" value={a} onChange={(e) => setA(e.target.value)}>
                <option value="">First essay</option>
                {data.map((d) => <option key={d.id} value={d.id}>{date(d.createdAt)} · {d.taskType === 'TASK1' ? 'Task 1' : 'Task 2'}</option>)}
              </Select>
              <Select aria-label="Second essay" value={b} onChange={(e) => setB(e.target.value)}>
                <option value="">Second essay</option>
                {data.map((d) => <option key={d.id} value={d.id}>{date(d.createdAt)} · {d.taskType === 'TASK1' ? 'Task 1' : 'Task 2'}</option>)}
              </Select>
              <Button onClick={compare} busy={busy} disabled={!a || !b || a === b}>Compare</Button>
            </div>
            {error && <Alert>{error}</Alert>}
            {cmp && (
              <>
                <Table head={['Measure', 'Earlier', 'Later']}>
                  {([
                    ['Date', (s: Side) => date(s.createdAt)],
                    ['AI estimate', (s: Side) => s.aiBand ?? '—'],
                    ['Words', (s: Side) => s.wordCount],
                    ['Paragraphs', (s: Side) => s.paragraphs ?? '—'],
                    ['Vocabulary range (higher is wider)', (s: Side) => s.vocabularyRange ?? '—'],
                    ['Grammar notes', (s: Side) => s.grammarIssues],
                    ['Vocabulary notes', (s: Side) => s.vocabularyIssues],
                    ['Task response notes', (s: Side) => s.taskIssues],
                    ['Coherence notes', (s: Side) => s.coherenceIssues],
                    ['Repeated words', (s: Side) => s.repeatedWords],
                    ['Weak phrases', (s: Side) => s.weakPhrases],
                  ] as [string, (s: Side) => string | number][]).map(([label, f]) => (
                    <tr key={label}><Td className="text-fg-muted">{label}</Td><Td>{f(cmp.a)}</Td><Td>{f(cmp.b)}</Td></tr>
                  ))}
                </Table>
                <p className="text-xs text-fg-subtle">{cmp.note}</p>
              </>
            )}
          </Card>

          <Table head={['Date', 'Task', 'Words', 'AI estimate', 'Grammar notes']}>
            {data.map((d) => (
              <tr key={d.id}><Td>{date(d.createdAt)}</Td><Td>{d.taskType === 'TASK1' ? 'Task 1' : 'Task 2'}</Td><Td>{d.wordCount}</Td><Td>{d.aiBand ?? '—'}</Td><Td>{d.grammarIssues}</Td></tr>
            ))}
          </Table>
        </div>
      )}
    </>
  );
}
