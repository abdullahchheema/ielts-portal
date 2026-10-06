'use client';

import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Empty, Loading, PageHeader, Section, StatCard, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { label } from '@/lib/format';

type Health = 'GREEN' | 'YELLOW' | 'RED';
interface BatchHealth {
  batch: string;
  status: Health;
  reasons: string[];
  metrics: { activeStudents: number; atRiskStudents: number };
  computedAt: string;
  cached: boolean;
}

const TONE: Record<Health, string> = {
  GREEN: 'bg-success-soft text-success',
  YELLOW: 'bg-warning-soft text-warning',
  RED: 'bg-danger-soft text-danger',
};

/** Batch health across open and running batches. Each rating states the reasons behind it. */
export default function BatchHealthPage() {
  const q = useQuery({ queryKey: ['batch-health'], queryFn: () => api<BatchHealth[]>('/admin/batches/health') });
  const rows = q.data ?? [];
  const count = (s: Health) => rows.filter((r) => r.status === s).length;

  return (
    <>
      <PageHeader title="Batch health" subtitle="Attendance, completion, skill averages, at-risk students and pending work, rated per batch. Each rating says why." />
      {q.isLoading && <Loading />}
      {q.isError && <Alert>Could not load batch health.</Alert>}
      {q.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Needs attention" value={count('RED')} attention={count('RED') > 0} />
            <StatCard label="Watch" value={count('YELLOW')} />
            <StatCard label="On track" value={count('GREEN')} />
          </div>
          <Section title="Batches">
            {rows.length === 0 ? <Empty title="No open or running batches" /> : (
              <Table head={['Batch', 'Status', 'Active', 'At risk', 'Why']}>
                {rows.map((r) => (
                  <tr key={r.batch}>
                    <Td className="font-medium">{r.batch}</Td>
                    <Td>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[r.status]}`}>{label(r.status)}</span>
                    </Td>
                    <Td>{r.metrics.activeStudents}</Td>
                    <Td>{r.metrics.atRiskStudents}</Td>
                    <Td className="max-w-md text-sm text-fg-muted">{r.reasons.length ? r.reasons.join(' ') : 'Nothing flagged.'}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Section>
          <Card className="mt-6 text-xs text-fg-subtle">
            Ratings are computed from the records and are guidance for the team. They are not a judgement of any teacher.
          </Card>
        </>
      )}
    </>
  );
}
