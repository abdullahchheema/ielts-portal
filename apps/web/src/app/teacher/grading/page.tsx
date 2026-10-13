'use client';

import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Empty, FilterBar, Loading, PageHeader, Pagination, Table, Tabs, Td } from '@/components/ui';
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
      <FilterBar count={data?.total}>
        <Tabs
          aria-label="Queue"
          value={status}
          onChange={(k) => { setStatus(k as typeof status); setSkip(0); }}
          items={[{ key: 'SUBMITTED', label: 'To grade' }, { key: 'GRADED', label: 'Graded' }]}
        />
      </FilterBar>
      {isLoading && <Loading />}
      {isError && <Alert>Could not load the queue.</Alert>}
      {data && (data.items.length === 0 ? (
        <Empty icon={ClipboardCheck} title={status === 'SUBMITTED' ? 'Nothing waiting' : 'No graded submissions yet'}>
          {status === 'SUBMITTED' ? 'Nice work — every submission has been graded.' : 'Graded work will appear here.'}
        </Empty>
      ) : (
        <>
          <Table sticky head={['Student', 'Task', 'Batch', 'Submitted', status === 'GRADED' ? 'Band' : 'Length', '']}>
            {data.items.map((s) => (
              <tr key={s.id}>
                <Td className="font-medium">{s.student}</Td>
                <Td>{s.title}<span className="block text-xs text-fg-muted">{label(s.skill)}</span></Td>
                <Td>{s.batch ?? '—'}</Td>
                <Td>{date(s.submittedAt, true)}{s.late && <span className="ml-2"><Badge status="LATE" tone="amber" /></span>}</Td>
                <Td>{status === 'GRADED' ? band(s.finalBand) : s.wordCount ? `${s.wordCount} words` : 'Audio'}</Td>
                <Td><Link href={`/teacher/grading/${s.id}`}><Button variant={status === 'SUBMITTED' ? 'primary' : 'secondary'} size="xs">{status === 'SUBMITTED' ? 'Grade' : 'Open'}</Button></Link></Td>
              </tr>
            ))}
          </Table>
          <Pagination skip={skip} take={PAGE} total={data.total} onSkip={setSkip} />
        </>
      ))}
    </>
  );
}
