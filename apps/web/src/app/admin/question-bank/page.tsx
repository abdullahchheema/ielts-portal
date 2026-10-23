'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, ClickableRow, Dialog, Empty, Field, FilterBar, Input, Loading, PageHeader, Pagination, SearchInput, Select, Table, TableToolbar, Td, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface SetRow {
  id: string; title: string; skill: string; module: string; topic: string | null; difficulty: number; status: string;
  studentFacing: boolean; questionCount: number;
}

const SKILLS = ['LISTENING', 'READING', 'WRITING', 'SPEAKING'] as const;
const TAKE = 25;

export default function QuestionBankPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [skill, setSkill] = useState('');
  const [status, setStatus] = useState('');
  const [topic, setTopic] = useState('');
  const [skip, setSkip] = useState(0);
  const params = new URLSearchParams({ take: String(TAKE), skip: String(skip), ...(skill ? { skill } : {}), ...(status ? { status } : {}), ...(topic ? { topic } : {}) });
  const { data, isLoading, isError } = useQuery({ queryKey: ['question-sets', skill, status, topic, skip], queryFn: () => api<{ total: number; items: SetRow[] }>(`/admin/question-sets?${params}`) });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', skill: 'READING', topic: '', difficulty: '3', module: 'ACADEMIC', source: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<'publish' | 'unpublish' | 'delete' | null>(null);

  async function removeSet(id: string) {
    if (!(await confirm({ message: 'Permanently delete this set and all of its questions? This cannot be undone.', confirmLabel: 'Delete set' }))) return;
    setDeletingId(id); setError(null);
    try {
      await api(`/admin/question-sets/${id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['question-sets'] });
    } catch (e) { setError(errorMessage(e)); } finally { setDeletingId(null); }
  }

  const rows = data?.items ?? [];
  const selectedRows = rows.filter((s) => selected.has(s.id));
  function toggleOne(id: string) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((s) => s.id))));
  }
  async function bulkAfter() {
    setSelected(new Set());
    await qc.invalidateQueries({ queryKey: ['question-sets'] });
  }

  async function bulkPublish() {
    const draftIds = selectedRows.filter((s) => s.status === 'DRAFT').map((s) => s.id);
    const publishIds = selectedRows.filter((s) => s.status === 'DRAFT' || s.status === 'APPROVED').map((s) => s.id);
    if (publishIds.length === 0) return;
    if (!(await confirm({ message: `Publish ${publishIds.length} set(s) so students see them in practice and free tests?`, confirmLabel: 'Publish' }))) return;
    setBulkBusy('publish'); setError(null);
    try {
      if (draftIds.length > 0) await api('/admin/question-sets/bulk/status', { method: 'POST', body: { ids: draftIds, status: 'APPROVED', studentFacing: false } });
      await api('/admin/question-sets/bulk/status', { method: 'POST', body: { ids: publishIds, status: 'PUBLISHED', studentFacing: true } });
      await bulkAfter();
    } catch (e) { setError(errorMessage(e)); } finally { setBulkBusy(null); }
  }

  async function bulkUnpublish() {
    const ids = selectedRows.filter((s) => s.status === 'PUBLISHED').map((s) => s.id);
    if (ids.length === 0) return;
    if (!(await confirm({ message: `Take ${ids.length} set(s) down? Students will stop seeing them in practice and free tests.`, confirmLabel: 'Unpublish', tone: 'danger' }))) return;
    setBulkBusy('unpublish'); setError(null);
    try {
      await api('/admin/question-sets/bulk/status', { method: 'POST', body: { ids, status: 'ARCHIVED', studentFacing: false } });
      await bulkAfter();
    } catch (e) { setError(errorMessage(e)); } finally { setBulkBusy(null); }
  }

  async function bulkRemove() {
    const ids = selectedRows.filter((s) => s.status === 'DRAFT' || s.status === 'ARCHIVED').map((s) => s.id);
    if (ids.length === 0) return;
    if (!(await confirm({ message: `Permanently delete ${ids.length} set(s) and all of their questions? This cannot be undone.`, confirmLabel: 'Delete sets', tone: 'danger' }))) return;
    setBulkBusy('delete'); setError(null);
    try {
      await api('/admin/question-sets/bulk/delete', { method: 'POST', body: { ids } });
      await bulkAfter();
    } catch (e) { setError(errorMessage(e)); } finally { setBulkBusy(null); }
  }

  async function create() {
    setBusy(true); setError(null);
    try {
      await api('/admin/question-sets', { method: 'POST', body: {
        title: f.title, skill: f.skill, module: f.module, difficulty: Number(f.difficulty),
        topic: f.topic || null, source: f.source || null, tags: [],
      } });
      await qc.invalidateQueries({ queryKey: ['question-sets'] });
      setOpen(false);
      setF({ title: '', skill: 'READING', topic: '', difficulty: '3', module: 'ACADEMIC', source: '' });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader
        title="Question bank"
        subtitle="Reusable questions and passages. Only published, student-facing sets reach students."
        actions={<div className="flex gap-2"><Link href="/admin/question-bank/import"><Button variant="secondary">Bulk import</Button></Link><Button onClick={() => setOpen(true)}>New set</Button></div>}
      />
      <FilterBar count={data?.total}>
        <SearchInput label="Search by topic" placeholder="Search by topic" value={topic} onDebounced={(v) => { setTopic(v); setSkip(0); }} />
        <Select aria-label="Skill" value={skill} onChange={(e) => { setSkill(e.target.value); setSkip(0); }}>
          <option value="">All skills</option>
          {SKILLS.map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setSkip(0); }}>
          <option value="">Any status</option>
          {['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'].map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
        </Select>
      </FilterBar>
      {error && <Alert>{error}</Alert>}
      {isLoading && <Loading />}
      {isError && <Alert>Could not load the question bank.</Alert>}
      {data && (data.items.length === 0 ? <Empty title="No sets yet">Create a set to start building the bank.</Empty> : (
        <>
          {selected.size > 0 && (
            <TableToolbar>
              <span className="text-sm font-medium text-fg-muted">{selected.size} selected</span>
              <Button variant="secondary" size="sm" onClick={bulkPublish} busy={bulkBusy === 'publish'} disabled={!!bulkBusy || !selectedRows.some((s) => s.status === 'DRAFT' || s.status === 'APPROVED')}>Publish</Button>
              <Button variant="secondary" size="sm" onClick={bulkUnpublish} busy={bulkBusy === 'unpublish'} disabled={!!bulkBusy || !selectedRows.some((s) => s.status === 'PUBLISHED')}>Unpublish</Button>
              <Button variant="ghost" tone="danger" size="sm" onClick={bulkRemove} busy={bulkBusy === 'delete'} disabled={!!bulkBusy || !selectedRows.some((s) => s.status === 'DRAFT' || s.status === 'ARCHIVED')}>Delete</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} disabled={!!bulkBusy}>Clear</Button>
            </TableToolbar>
          )}
          <Table head={['', 'Title', 'Skill', 'Topic', 'Difficulty', 'Questions', 'Status', '']} sticky>
            {data.items.map((s) => (
              <ClickableRow key={s.id} onClick={() => router.push(`/admin/question-bank/${s.id}`)}>
                <Td>
                  <input
                    type="checkbox" aria-label={`Select ${s.title}`} checked={selected.has(s.id)}
                    onClick={(e) => e.stopPropagation()} onChange={() => toggleOne(s.id)}
                    className="size-4 rounded border-border accent-primary"
                  />
                </Td>
                <Td><Link href={`/admin/question-bank/${s.id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{s.title}</Link></Td>
                <Td>{s.skill}</Td>
                <Td>{s.topic ?? '—'}</Td>
                <Td>{s.difficulty}/5</Td>
                <Td>{s.questionCount}</Td>
                <Td><Badge status={s.status} />{s.studentFacing && <span className="ml-2 text-xs text-success">Student-facing</span>}</Td>
                <Td>{(s.status === 'DRAFT' || s.status === 'ARCHIVED') && <Button variant="ghost" tone="danger" size="xs" onClick={(e) => { e.stopPropagation(); removeSet(s.id); }} busy={deletingId === s.id} disabled={!!deletingId}>Delete</Button>}</Td>
              </ClickableRow>
            ))}
          </Table>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-fg-muted">
              <input type="checkbox" className="size-4 rounded border-border accent-primary" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} />
              Select all on this page
            </label>
            <Pagination skip={skip} take={TAKE} total={data.total} onSkip={setSkip} />
          </div>
        </>
      ))}

      <Dialog open={open} onClose={() => setOpen(false)} title="New question set">
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <Field label="Title">{(p) => <Input {...p} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Skill">{(p) => <Select {...p} value={f.skill} onChange={(e) => setF({ ...f, skill: e.target.value })}>{SKILLS.map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}</Select>}</Field>
            <Field label="Module">{(p) => <Select {...p} value={f.module} onChange={(e) => setF({ ...f, module: e.target.value })}><option value="ACADEMIC">Academic</option><option value="GENERAL">General</option><option value="BOTH">Both</option></Select>}</Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Topic">{(p) => <Input {...p} value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} placeholder="e.g. travel" />}</Field>
            <Field label="Difficulty (1–5)">{(p) => <Input {...p} type="number" min={1} max={5} value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })} />}</Field>
          </div>
          <Field label="Source (optional)">{(p) => <Input {...p} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} />}</Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} busy={busy} disabled={f.title.trim().length < 3}>Create set</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
