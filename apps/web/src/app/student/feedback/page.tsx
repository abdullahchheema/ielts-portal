'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Alert, Badge, Empty, Input, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { band, date } from '@/lib/format';

interface Sub { id: string; title: string; skill: string; status: string; submittedAt: string; gradedAt: string | null; finalBand: number | null }

export default function FeedbackHistoryPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['submissions'], queryFn: () => api<Sub[]>('/me/submissions') });
  const [skill, setSkill] = useState<'ALL' | 'WRITING' | 'SPEAKING'>('ALL');
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((s) => (skill === 'ALL' || s.skill === skill) && (!term || s.title.toLowerCase().includes(term)));
  }, [data, skill, q]);

  return (
    <>
      <PageHeader title="Feedback & History" subtitle="Every writing and speaking submission you've made, and the mentor feedback it received, in one searchable place." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Skill" className="flex gap-2">
          {(['ALL', 'WRITING', 'SPEAKING'] as const).map((s) => (
            <button key={s} role="tab" aria-selected={skill === s} onClick={() => setSkill(s)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${skill === s ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300'}`}>
              {s === 'ALL' ? 'All' : s[0] + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <Input placeholder="Search by title…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
      </div>

      {isLoading && <Loading />}
      {isError && <Alert>Could not load your submissions.</Alert>}
      {data && (filtered.length === 0 ? (
        <Empty>{data.length === 0 ? "You haven't submitted any writing or speaking work yet." : 'No submissions match this filter.'}</Empty>
      ) : (
        <Table head={['Task', 'Skill', 'Submitted', 'Status', 'Band', '']}>
          {filtered.map((s) => (
            <tr key={s.id}>
              <Td className="font-medium">{s.title}</Td>
              <Td>{s.skill[0] + s.skill.slice(1).toLowerCase()}</Td>
              <Td>{date(s.submittedAt, true)}</Td>
              <Td><Badge status={s.status} /></Td>
              <Td>{s.finalBand !== null ? <strong>{band(s.finalBand)}</strong> : '—'}</Td>
              <Td><Link href={`/student/submissions/${s.id}`} className="font-medium text-indigo-700 hover:underline">{s.status === 'GRADED' ? 'View feedback' : 'View'}</Link></Td>
            </tr>
          ))}
        </Table>
      ))}
    </>
  );
}
