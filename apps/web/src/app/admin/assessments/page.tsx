'use client';

import { SkeletonTable } from '@/components/ui';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Dialog, Empty, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { label } from '@/lib/format';

interface Row { id: string; title: string; type: string; skill: string | null; maxAttempts: number | null; timeLimitMin: number | null; passPercent: number; versions: { id: string; version: number; publishedAt: string | null }[]; _count: { attempts: number } }
const TYPES = ['PRACTICE', 'QUIZ', 'LISTENING', 'READING', 'MOCK', 'DIAGNOSTIC', 'FINAL'];

export default function AssessmentsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-assessments'], queryFn: () => api<Row[]>('/admin/assessments') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', type: 'QUIZ', skill: '', maxAttempts: '', timeLimitMin: '', passPercent: '0', showAnswers: true });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true); setError(null);
    try {
      await api('/admin/assessments', { method: 'POST', body: { title: f.title, type: f.type, skill: f.skill || undefined, maxAttempts: f.maxAttempts ? Number(f.maxAttempts) : undefined, timeLimitMin: f.timeLimitMin ? Number(f.timeLimitMin) : undefined, passPercent: Number(f.passPercent), showAnswers: f.showAnswers } });
      await qc.invalidateQueries({ queryKey: ['admin-assessments'] }); setOpen(false);
      setF({ title: '', type: 'QUIZ', skill: '', maxAttempts: '', timeLimitMin: '', passPercent: '0', showAnswers: true });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  if (isLoading) return <SkeletonTable rows={6} cols={5} />;
  if (isError || !data) return <Alert>Could not load assessments.</Alert>;
  return (
    <>
      <PageHeader title="Assessments" subtitle="Quizzes, listening and reading tests, mocks and diagnostics. Link one to a lesson from the course builder." actions={<Button onClick={() => setOpen(true)}>New assessment</Button>} />
      {data.length === 0 ? <Empty>No assessments yet.</Empty> : (
        <Table head={['Title', 'Type', 'Skill', 'Limits', 'Versions', 'Attempts', '']}>
          {data.map((a) => (
            <tr key={a.id}>
              <Td className="font-medium">{a.title}</Td><Td>{label(a.type)}</Td><Td>{a.skill ? label(a.skill) : '—'}</Td>
              <Td>{a.timeLimitMin ? `${a.timeLimitMin} min` : 'untimed'}{a.maxAttempts ? ` · ${a.maxAttempts} tries` : ''}{a.passPercent ? ` · pass ${a.passPercent}%` : ''}</Td>
              <Td>{a.versions.map((v) => <span key={v.id} className="mr-1 inline-flex items-center gap-1"><Badge status={v.publishedAt ? 'PUBLISHED' : 'DRAFT'} />v{v.version}</span>)}</Td>
              <Td>{a._count.attempts}</Td>
              <Td><Link href={`/admin/assessments/${a.id}`} className="text-primary hover:underline">Build</Link></Td>
            </tr>
          ))}
        </Table>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="New assessment">
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <Field label="Title">{(p) => <Input {...p} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">{(p) => <Select {...p} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select>}</Field>
            <Field label="Skill" hint="Listening/reading tests get a band score.">{(p) => <Select {...p} value={f.skill} onChange={(e) => setF({ ...f, skill: e.target.value })}><option value="">None</option><option value="LISTENING">Listening</option><option value="READING">Reading</option></Select>}</Field>
            <Field label="Time limit (min)" hint="Blank = untimed">{(p) => <Input {...p} type="number" min={1} value={f.timeLimitMin} onChange={(e) => setF({ ...f, timeLimitMin: e.target.value })} />}</Field>
            <Field label="Max attempts" hint="Blank = unlimited">{(p) => <Input {...p} type="number" min={1} value={f.maxAttempts} onChange={(e) => setF({ ...f, maxAttempts: e.target.value })} />}</Field>
            <Field label="Pass mark %" hint="Needed to complete the lesson">{(p) => <Input {...p} type="number" min={0} max={100} value={f.passPercent} onChange={(e) => setF({ ...f, passPercent: e.target.value })} />}</Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.showAnswers} onChange={(e) => setF({ ...f, showAnswers: e.target.checked })} /> Show correct answers after submission</label>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button busy={busy} disabled={f.title.trim().length < 2} onClick={create}>Create</Button></div>
        </div>
      </Dialog>
    </>
  );
}
