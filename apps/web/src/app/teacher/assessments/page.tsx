'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Dialog, Empty, Field, Input, Loading, PageHeader, Select, Table, Td, Tooltip } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { label } from '@/lib/format';

interface Row { id: string; title: string; type: string; skill: string | null; timeLimitMin: number | null; versions: { id: string; version: number; publishedAt: string | null }[]; _count: { attempts: number } }

/** A teacher's own Listening/Reading assessments — scoped server-side to createdByMentorId, so
 *  this list (and everything linked from it) only ever shows this mentor's own drafts. */
export default function TeacherAssessmentsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['teacher-assessments'], queryFn: () => api<Row[]>('/mentor/assessments') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', skill: 'LISTENING' as 'LISTENING' | 'READING', timeLimitMin: '30' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true); setError(null);
    try {
      await api('/mentor/assessments', { method: 'POST', body: { title: f.title, type: f.skill, skill: f.skill, timeLimitMin: f.timeLimitMin ? Number(f.timeLimitMin) : undefined } });
      await qc.invalidateQueries({ queryKey: ['teacher-assessments'] }); setOpen(false);
      setF({ title: '', skill: 'LISTENING', timeLimitMin: '30' });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>Could not load your assessments.</Alert>;

  return (
    <>
      <PageHeader title="My assessments" subtitle="Build a Listening or Reading test from scratch. Students complete it once you've assigned it to a lesson." actions={<Button onClick={() => setOpen(true)}>New assessment</Button>} />
      {data.length === 0 ? <Empty title="No assessments yet">Create one to start building a test.</Empty> : (
        <Table head={['Title', 'Skill', 'Time limit', 'Versions', 'Attempts', '']} sticky>
          {data.map((a) => (
            <tr key={a.id}>
              <Td className="font-medium">{a.title}</Td>
              <Td>{a.skill ? label(a.skill) : '—'}</Td>
              <Td>{a.timeLimitMin ? `${a.timeLimitMin} min` : 'untimed'}</Td>
              <Td>
                <Tooltip content={a.versions.map((v) => `v${v.version} — ${v.publishedAt ? 'Published' : 'Draft'}`).join(', ')}>
                  <span className="inline-flex cursor-default items-center gap-1">{a.versions.map((v) => <span key={v.id} className="mr-1 inline-flex items-center gap-1"><Badge status={v.publishedAt ? 'PUBLISHED' : 'DRAFT'} />v{v.version}</span>)}</span>
                </Tooltip>
              </Td>
              <Td className="tabular-nums">{a._count.attempts}</Td>
              <Td><Link href={`/teacher/assessments/${a.id}`} className="text-primary hover:underline">Build</Link></Td>
            </tr>
          ))}
        </Table>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="New assessment">
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <Field label="Title">{(p) => <Input {...p} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Skill">{(p) => <Select {...p} value={f.skill} onChange={(e) => setF({ ...f, skill: e.target.value as 'LISTENING' | 'READING' })}><option value="LISTENING">Listening</option><option value="READING">Reading</option></Select>}</Field>
            <Field label="Time limit (min)" hint="Blank = untimed">{(p) => <Input {...p} type="number" min={1} value={f.timeLimitMin} onChange={(e) => setF({ ...f, timeLimitMin: e.target.value })} />}</Field>
          </div>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button busy={busy} disabled={f.title.trim().length < 2} onClick={create}>Create</Button></div>
        </div>
      </Dialog>
    </>
  );
}
