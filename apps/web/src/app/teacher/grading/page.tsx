'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Empty, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { band, date, label } from '@/lib/format';

interface Row { id: string; title: string; skill: string; status: string; submittedAt: string; late: boolean; wordCount: number | null; student: string; batch: string | null; finalBand: number | null }
const PAGE = 25;

export default function GradingQueuePage() {
  const [status, setStatus] = useState<'SUBMITTED' | 'GRADED'>('SUBMITTED');
  const [skip, setSkip] = useState(0);
  const { data, isLoading, isError } = useQuery({ queryKey: ['grading-queue', status, skip], queryFn: () => api<{ total: number; items: Row[] }>(`/mentor/submissions?status=${status}&skip=${skip}&take=${PAGE}`) });

  return (
    <>
      <PageHeader title="Grading queue" subtitle={status === 'SUBMITTED' ? 'Oldest first, so nobody waits longer than they should.' : 'Recently graded work. Open one to adjust a grade.'} />
      <div role="tablist" aria-label="Queue" className="mb-4 flex gap-2">
        {(['SUBMITTED', 'GRADED'] as const).map((s) => (
          <button key={s} role="tab" aria-selected={status === s} onClick={() => { setStatus(s); setSkip(0); }} className={`rounded-md px-3 py-1.5 text-sm font-medium ${status === s ? 'bg-primary text-white' : 'bg-surface text-fg ring-1 ring-border-strong'}`}>{s === 'SUBMITTED' ? 'To grade' : 'Graded'}</button>
        ))}
      </div>
      {isLoading && <Loading />}
      {isError && <Alert>Could not load the queue.</Alert>}
      {data && (data.items.length === 0 ? <Empty>{status === 'SUBMITTED' ? 'Nothing waiting — nice work.' : 'No graded submissions yet.'}</Empty> : (
        <>
          <Table head={['Student', 'Task', 'Batch', 'Submitted', status === 'GRADED' ? 'Band' : 'Length', '']}>
            {data.items.map((s) => (
              <tr key={s.id}>
                <Td className="font-medium">{s.student}</Td>
                <Td>{s.title}<span className="block text-xs text-fg-muted">{label(s.skill)}</span></Td>
                <Td>{s.batch ?? '—'}</Td>
                <Td>{date(s.submittedAt, true)}{s.late && <span className="ml-2"><Badge status="LATE" tone="amber" /></span>}</Td>
                <Td>{status === 'GRADED' ? band(s.finalBand) : s.wordCount ? `${s.wordCount} words` : 'Audio'}</Td>
                <Td><Link href={`/teacher/grading/${s.id}`}><Button variant={status === 'SUBMITTED' ? 'primary' : 'secondary'} className="!py-1">{status === 'SUBMITTED' ? 'Grade' : 'Open'}</Button></Link></Td>
              </tr>
            ))}
          </Table>
          <div className="mt-3 flex items-center justify-between text-sm text-fg-muted">
            <span>{data.total} total</span>
            <div className="flex gap-2"><Button variant="secondary" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE))}>Previous</Button><Button variant="secondary" disabled={skip + PAGE >= data.total} onClick={() => setSkip(skip + PAGE)}>Next</Button></div>
          </div>
        </>
      ))}
    </>
  );
}
