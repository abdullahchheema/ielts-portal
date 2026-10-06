'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface Mock { id: string; title: string; skill: string; timeLimitMin: number | null; libraryVisible: boolean; published: boolean }

/**
 * Builds mock papers from published bank content. A new mock is a draft: publish it from its assessment page,
 * then show it in the student library. Nothing is written by AI.
 */
export default function MockExamsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-mocks'], queryFn: () => api<Mock[]>('/admin/mock-exams') });
  const [f, setF] = useState({ title: '', skill: 'LISTENING', count: '20', durationMin: '30', difficultyMin: '1', difficultyMax: '5', topic: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function compose() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const out = await api<{ assessmentId: string; questionCount: number }>('/admin/mock-exams/compose', { method: 'POST', body: {
        title: f.title, skill: f.skill, count: Number(f.count), durationMin: Number(f.durationMin),
        difficultyMin: Number(f.difficultyMin), difficultyMax: Number(f.difficultyMax), topic: f.topic || undefined,
      } });
      setNotice(`Draft created with ${out.questionCount} questions. Publish it from its page, then show it in the library.`);
      await qc.invalidateQueries({ queryKey: ['admin-mocks'] });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function toggle(m: Mock) {
    setError(null);
    try {
      await api(`/admin/mock-exams/${m.id}/library`, { method: 'POST', body: { visible: !m.libraryVisible } });
      await qc.invalidateQueries({ queryKey: ['admin-mocks'] });
    } catch (e) { setError(errorMessage(e)); }
  }

  return (
    <>
      <PageHeader title="Mock tests" subtitle="Compose a mock from published questions, publish it, then open it in the student library." />
      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card className="mb-8 max-w-3xl space-y-4">
        <h2 className="font-semibold text-fg">Compose a mock</h2>
        <Field label="Title">{(p) => <Input {...p} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Skill">{(p) => <Select {...p} value={f.skill} onChange={(e) => setF({ ...f, skill: e.target.value })}><option value="LISTENING">Listening</option><option value="READING">Reading</option></Select>}</Field>
          <Field label="Questions">{(p) => <Input {...p} type="number" min={5} max={60} value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} />}</Field>
          <Field label="Minutes">{(p) => <Input {...p} type="number" min={5} max={180} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value })} />}</Field>
          <Field label="Topic (optional)">{(p) => <Input {...p} value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} />}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:w-1/2">
          <Field label="Min difficulty">{(p) => <Input {...p} type="number" min={1} max={5} value={f.difficultyMin} onChange={(e) => setF({ ...f, difficultyMin: e.target.value })} />}</Field>
          <Field label="Max difficulty">{(p) => <Input {...p} type="number" min={1} max={5} value={f.difficultyMax} onChange={(e) => setF({ ...f, difficultyMax: e.target.value })} />}</Field>
        </div>
        <div className="flex justify-end">
          <Button onClick={compose} busy={busy} disabled={f.title.trim().length < 3}>Create draft</Button>
        </div>
      </Card>

      {isLoading && <Loading />}
      {isError && <Alert>Could not load mock tests.</Alert>}
      {data && (data.length === 0 ? <Empty title="No mock tests yet">Create a draft above.</Empty> : (
        <Table head={['Title', 'Skill', 'Minutes', 'Published', 'In library', '']}>
          {data.map((m) => (
            <tr key={m.id}>
              <Td className="font-medium">{m.title}</Td>
              <Td>{m.skill.toLowerCase()}</Td>
              <Td>{m.timeLimitMin ?? '—'}</Td>
              <Td><Badge status={m.published ? 'PUBLISHED' : 'DRAFT'} /></Td>
              <Td>{m.libraryVisible ? 'Yes' : 'No'}</Td>
              <Td>
                <div className="flex gap-2">
                  <Link href={`/admin/assessments/${m.id}`} className="inline-flex h-8 items-center rounded-md px-2 text-sm text-primary hover:underline">Open</Link>
                  <Button variant="ghost" className="!py-1" disabled={!m.published && !m.libraryVisible} onClick={() => toggle(m)}>{m.libraryVisible ? 'Hide from library' : 'Show in library'}</Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      ))}
    </>
  );
}
