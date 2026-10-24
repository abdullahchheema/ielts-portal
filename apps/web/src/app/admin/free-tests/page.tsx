'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge, Button, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';

interface PoolStats { listening: number; reading: number; writing: number; speaking: number }
interface ModuleRow { id: string; skill: string; title: string; published: boolean; eligibleForFreeTestRotation: boolean; questionCount: number; createdAt: string }
interface ModuleStatRow { id: string; title: string; skill: string; picks: number; completed: number }

export default function FreeTestsAdminPage() {
  const qc = useQueryClient();
  const { data: pool, isLoading } = useQuery({ queryKey: ['free-test-pool'], queryFn: () => api<PoolStats>('/admin/free-test-pool') });
  const { data: modules, isLoading: modulesLoading } = useQuery({ queryKey: ['free-test-modules'], queryFn: () => api<ModuleRow[]>('/admin/free-test-pool/modules') });
  const { data: stats, isLoading: statsLoading } = useQuery({ queryKey: ['free-test-analytics'], queryFn: () => api<ModuleStatRow[]>('/admin/free-test-pool/analytics') });

  async function toggleEligibility(id: string, eligible: boolean) {
    await api(`/admin/free-test-pool/modules/${id}/rotation-eligibility`, { method: 'PATCH', body: { eligible } });
    await qc.invalidateQueries({ queryKey: ['free-test-modules'] });
  }

  return (
    <>
      <PageHeader
        title="Free test pool"
        subtitle="All 4 skills' content lives in the question bank — upload, approve, publish there, exactly the same for Listening, Reading, Writing and Speaking. A published, student-facing set is immediately eligible: a free-test visitor gets one module per skill, picked from whichever has been used least."
        actions={<Link href="/admin/question-bank/import"><Button>Upload to question bank</Button></Link>}
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
              {count === 0 && <div className="mt-1"><Badge status="NOTHING_ELIGIBLE" tone="red" text="Nothing eligible yet" /></div>}
            </div>
          ))}
        </div>
      )}

      <h2 className="mb-2 mt-8 font-semibold">Modules</h2>
      <p className="mb-2 text-xs text-fg-muted">The rotation checkbox lets you take a specific module out of the free-test pick without unpublishing it — admins still see it in the bank, students just stop being routed to it.</p>
      {modulesLoading ? <Loading /> : (
        <Table head={['Title', 'Skill', 'Questions', 'Published', 'In rotation', 'Created']}>
          {(modules ?? []).map((m) => (
            <tr key={m.id}>
              <Td><Link href={`/admin/question-bank/${m.id}`} className="text-primary hover:underline">{m.title}</Link></Td>
              <Td>{m.skill.toLowerCase()}</Td>
              <Td>{m.questionCount}</Td>
              <Td><Badge status={m.published ? 'PUBLISHED' : 'ARCHIVED'} tone={m.published ? 'green' : 'slate'} /></Td>
              <Td>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 rounded border-border accent-primary" checked={m.eligibleForFreeTestRotation} onChange={(e) => toggleEligibility(m.id, e.target.checked)} />
                  {m.eligibleForFreeTestRotation ? 'Eligible' : 'Excluded'}
                </label>
              </Td>
              <Td>{new Date(m.createdAt).toLocaleDateString()}</Td>
            </tr>
          ))}
        </Table>
      )}

      <h2 className="mb-2 mt-8 font-semibold">Module usage</h2>
      <p className="mb-2 text-xs text-fg-muted">How often each module has been presented to a free-test visitor, and how many of those presentations were actually completed.</p>
      {statsLoading ? <Loading /> : (
        <Table head={['Title', 'Skill', 'Times presented', 'Times completed']}>
          {(stats ?? []).map((s) => (
            <tr key={s.id}>
              <Td><Link href={`/admin/question-bank/${s.id}`} className="text-primary hover:underline">{s.title}</Link></Td>
              <Td>{s.skill.toLowerCase()}</Td>
              <Td className="tabular-nums">{s.picks}</Td>
              <Td className="tabular-nums">{s.completed}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
