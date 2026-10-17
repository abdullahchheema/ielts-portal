'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';

interface PoolStats { listening: number; reading: number; writing: number; speaking: number }
interface LeadRow {
  id: string; email: string; phone: string; status: string; stage: string | null; examStatus: string | null;
  overallEstimate: number | null; missingSkills: string[]; createdAt: string; linked: boolean;
}

export default function FreeTestsAdminPage() {
  const { data: pool, isLoading } = useQuery({ queryKey: ['free-test-pool'], queryFn: () => api<PoolStats>('/admin/free-test-pool') });
  const { data: leads } = useQuery({ queryKey: ['free-test-leads'], queryFn: () => api<{ total: number; items: LeadRow[] }>('/admin/free-test-leads') });

  return (
    <>
      <PageHeader
        title="Free test pool"
        subtitle="Free-test visitors get a full 4-skill mock assembled from whatever's published. There's nothing to configure here — publish a diagnostic Listening/Reading assessment, or a published, student-facing Writing/Speaking prompt, and it's immediately eligible for rotation."
      />

      <h2 className="mb-2 mt-6 font-semibold">Eligible pool, by skill</h2>
      {isLoading ? <Loading /> : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {([
            ['Listening', pool?.listening ?? 0],
            ['Reading', pool?.reading ?? 0],
            ['Writing', pool?.writing ?? 0],
            ['Speaking', pool?.speaking ?? 0],
          ] as const).map(([label, count]) => (
            <div key={label} className="rounded-lg border p-4">
              <div className="text-xs text-fg-muted">{label}</div>
              <div className="text-2xl font-semibold">{count}</div>
              {count === 0 && <div className="mt-1 text-xs text-red-600">Nothing eligible yet</div>}
            </div>
          ))}
        </div>
      )}

      <h2 className="mb-2 mt-8 font-semibold">Recent leads</h2>
      <Table head={['Email', 'Phone', 'Status', 'Stage', 'Overall estimate', 'Linked to account', 'Claimed']}>
        {(leads?.items ?? []).map((l) => (
          <tr key={l.id}>
            <Td>{l.email}</Td>
            <Td>{l.phone}</Td>
            <Td><Badge status={l.status} /></Td>
            <Td>{l.stage ?? '—'}</Td>
            <Td>{l.overallEstimate != null ? l.overallEstimate : l.missingSkills.length ? `Partial (missing ${l.missingSkills.join(', ')})` : '—'}</Td>
            <Td>{l.linked ? 'Yes' : 'No'}</Td>
            <Td>{new Date(l.createdAt).toLocaleString()}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
