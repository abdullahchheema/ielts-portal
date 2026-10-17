'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge, Button, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';

interface PoolStats { listening: number; reading: number; writing: number; speaking: number }
interface LeadRow {
  id: string; email: string; phone: string; status: string; stage: string | null; examStatus: string | null;
  overallEstimate: number | null; missingSkills: string[]; createdAt: string; linked: boolean;
}
interface ModuleRow { id: string; skill: string; title: string; published: boolean; questionCount: number; createdAt: string }

export default function FreeTestsAdminPage() {
  const { data: pool, isLoading } = useQuery({ queryKey: ['free-test-pool'], queryFn: () => api<PoolStats>('/admin/free-test-pool') });
  const { data: modules, isLoading: modulesLoading } = useQuery({ queryKey: ['free-test-modules'], queryFn: () => api<ModuleRow[]>('/admin/free-test-pool/modules') });
  const { data: leads } = useQuery({ queryKey: ['free-test-leads'], queryFn: () => api<{ total: number; items: LeadRow[] }>('/admin/free-test-leads') });

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
              {count === 0 && <div className="mt-1 text-xs text-red-600">Nothing eligible yet</div>}
            </div>
          ))}
        </div>
      )}

      <h2 className="mb-2 mt-8 font-semibold">Modules</h2>
      {modulesLoading ? <Loading /> : (
        <Table head={['Title', 'Skill', 'Questions', 'Published', 'Created']}>
          {(modules ?? []).map((m) => (
            <tr key={m.id}>
              <Td><Link href={`/admin/question-bank/${m.id}`} className="text-primary hover:underline">{m.title}</Link></Td>
              <Td>{m.skill.toLowerCase()}</Td>
              <Td>{m.questionCount}</Td>
              <Td><Badge status={m.published ? 'PUBLISHED' : 'DRAFT'} tone={m.published ? 'green' : 'slate'} /></Td>
              <Td>{new Date(m.createdAt).toLocaleDateString()}</Td>
            </tr>
          ))}
        </Table>
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
