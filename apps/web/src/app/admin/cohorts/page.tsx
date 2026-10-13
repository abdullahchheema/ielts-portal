'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Empty, Field, Input, Loading, PageHeader, Section, Table, Tabs, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { errorMessage } from '@/lib/errors';

interface Group {
  key: string; label: string; size: number; suppressed: boolean;
  enrolled?: number; activationPercent?: number; completionPercent?: number;
}

/** Compares batches or enrolment months. Groups under the minimum size are withheld, never shown as numbers. */
const toIso = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toISOString() : undefined);

export default function CohortsPage() {
  const [groupBy, setGroupBy] = useState<'batch' | 'month'>('batch');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const query = new URLSearchParams({ groupBy, ...(toIso(from) ? { from: toIso(from)! } : {}), ...(toIso(to) ? { to: toIso(to)! } : {}) }).toString();
  const { data, isLoading, isError } = useQuery({ queryKey: ['cohorts', groupBy, from, to], queryFn: () => api<Group[]>(`/admin/cohorts?${query}`) });

  async function exportCsv() {
    setError(null);
    try { await downloadCsv(`/admin/cohorts.csv?${query}`); } catch (e) { setError(errorMessage(e)); }
  }

  return (
    <>
      <PageHeader
        title="Cohorts"
        subtitle="How enrolment, activation and completion compare across batches or months. Small groups are not shown."
        actions={<Button variant="secondary" onClick={exportCsv}>Export CSV</Button>}
      />
      <Tabs
        aria-label="Compare by"
        items={[{ key: 'batch', label: 'By batch' }, { key: 'month', label: 'By enrolment month' }]}
        value={groupBy}
        onChange={(k) => setGroupBy(k as 'batch' | 'month')}
      />
      <div className="mt-3 mb-4 flex flex-wrap gap-3">
        <div className="w-44"><Field label="From" hint="Optional">{(p) => <Input {...p} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />}</Field></div>
        <div className="w-44"><Field label="To" hint="Optional">{(p) => <Input {...p} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />}</Field></div>
      </div>
      {error && <Alert>{error}</Alert>}
      {isLoading && <Loading />}
      {isError && <Alert>Could not load cohorts.</Alert>}
      {data && (
        <Section title="Groups">
          {data.length === 0 ? <Empty title="No enrolments yet" /> : (
            <Table sticky head={['Group', 'Enrolled', 'Activation', 'Completion']}>
              {data.map((g) => (
                <tr key={g.key}>
                  <Td className="font-medium">{g.label}</Td>
                  <Td>{g.suppressed ? `${g.size} (too few to compare)` : g.enrolled}</Td>
                  <Td className="tabular-nums">{g.suppressed ? '—' : `${g.activationPercent}%`}</Td>
                  <Td className="tabular-nums">{g.suppressed ? '—' : `${g.completionPercent}%`}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
      )}
    </>
  );
}
