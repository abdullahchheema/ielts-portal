'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Empty, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { errorMessage } from '@/lib/errors';

interface Group {
  key: string; label: string; size: number; suppressed: boolean;
  enrolled?: number; activationPercent?: number; completionPercent?: number;
}

/** Compares batches or enrolment months. Groups under the minimum size are withheld, never shown as numbers. */
export default function CohortsPage() {
  const [groupBy, setGroupBy] = useState<'batch' | 'month'>('batch');
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({ queryKey: ['cohorts', groupBy], queryFn: () => api<Group[]>(`/admin/cohorts?groupBy=${groupBy}`) });

  async function exportCsv() {
    setError(null);
    try { await downloadCsv(`/admin/cohorts.csv?groupBy=${groupBy}`); } catch (e) { setError(errorMessage(e)); }
  }

  return (
    <>
      <PageHeader
        title="Cohorts"
        subtitle="How enrolment, activation and completion compare across batches or months. Small groups are not shown."
        actions={<Button variant="secondary" onClick={exportCsv}>Export CSV</Button>}
      />
      <div className="mb-4">
        <Select aria-label="Compare by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'batch' | 'month')}>
          <option value="batch">By batch</option>
          <option value="month">By enrolment month</option>
        </Select>
      </div>
      {error && <Alert>{error}</Alert>}
      {isLoading && <Loading />}
      {isError && <Alert>Could not load cohorts.</Alert>}
      {data && (data.length === 0 ? <Empty title="No enrolments yet" /> : (
        <Table head={['Group', 'Enrolled', 'Activation', 'Completion']}>
          {data.map((g) => (
            <tr key={g.key}>
              <Td className="font-medium">{g.label}</Td>
              <Td>{g.suppressed ? `${g.size} (too few to compare)` : g.enrolled}</Td>
              <Td className="tabular-nums">{g.suppressed ? '—' : `${g.activationPercent}%`}</Td>
              <Td className="tabular-nums">{g.suppressed ? '—' : `${g.completionPercent}%`}</Td>
            </tr>
          ))}
        </Table>
      ))}
    </>
  );
}
