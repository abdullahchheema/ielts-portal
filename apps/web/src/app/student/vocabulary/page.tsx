'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Empty, Field, Input, Loading, PageHeader, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { label } from '@/lib/format';

interface VocabEntry {
  id: string; term: string; definition: string | null; example: string | null; collocation: string | null;
  sourceType: string | null; studentExample: string | null; reviewStatus: 'NEW' | 'LEARNING' | 'KNOWN'; reviewCount: number;
}

const STATUS_FILTERS = ['ALL', 'NEW', 'LEARNING', 'KNOWN'] as const;

export default function VocabularyPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['vocabulary'], queryFn: () => api<VocabEntry[]>('/me/vocabulary') });
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>('ALL');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ term: '', definition: '', example: '', collocation: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function create() {
    setBusy(true); setFormError(null);
    try {
      await api('/me/vocabulary', { method: 'POST', body: { term: f.term, definition: f.definition || undefined, example: f.example || undefined, collocation: f.collocation || undefined, sourceType: 'MANUAL' } });
      await qc.invalidateQueries({ queryKey: ['vocabulary'] });
      setOpen(false); setF({ term: '', definition: '', example: '', collocation: '' });
    } catch (e) { setFormError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function setStatus(id: string, reviewStatus: VocabEntry['reviewStatus']) {
    await api(`/me/vocabulary/${id}`, { method: 'PATCH', body: { reviewStatus } });
    qc.invalidateQueries({ queryKey: ['vocabulary'] });
  }
  async function remove(id: string) {
    await api(`/me/vocabulary/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['vocabulary'] });
  }

  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>{errorMessage(error)}</Alert>;
  const shown = filter === 'ALL' ? data : data.filter((e) => e.reviewStatus === filter);

  return (
    <>
      <PageHeader title="Vocabulary" subtitle="Words and phrases you have saved from lessons, reading, and feedback." actions={<Button onClick={() => setOpen(true)}>Add word</Button>} />
      <div className="mb-4 flex gap-2">
        {STATUS_FILTERS.map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`rounded-full px-3 py-1 text-xs font-medium ${filter === s ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
            {s === 'ALL' ? 'All' : label(s)} {s !== 'ALL' ? `(${data.filter((e) => e.reviewStatus === s).length})` : `(${data.length})`}
          </button>
        ))}
      </div>
      {!shown.length ? <Empty>{filter === 'ALL' ? 'You have not saved any vocabulary yet. Save words as you work through lessons and feedback.' : `No words marked ${label(filter)}.`}</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((e) => (
            <Card key={e.id}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-slate-900">{e.term}</h3>
                <Badge status={e.reviewStatus} />
              </div>
              {e.definition && <p className="mt-1 text-sm text-slate-700">{e.definition}</p>}
              {e.collocation && <p className="mt-1 text-xs text-slate-500">Collocation: {e.collocation}</p>}
              {e.example && <p className="mt-1 text-xs italic text-slate-500">&ldquo;{e.example}&rdquo;</p>}
              <div className="mt-3 flex gap-3 text-xs">
                {(['NEW', 'LEARNING', 'KNOWN'] as const).filter((s) => s !== e.reviewStatus).map((s) => (
                  <button key={s} onClick={() => setStatus(e.id, s)} className="font-medium text-indigo-700 hover:underline">Mark {label(s)}</button>
                ))}
                <button onClick={() => remove(e.id)} className="ml-auto font-medium text-red-700 hover:underline">Remove</button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Add a word">
        <div className="space-y-3">
          {formError && <Alert>{formError}</Alert>}
          <Field label="Word or phrase">{(p) => <Input {...p} value={f.term} onChange={(e) => setF({ ...f, term: e.target.value })} />}</Field>
          <Field label="Definition (optional)">{(p) => <Textarea {...p} rows={2} value={f.definition} onChange={(e) => setF({ ...f, definition: e.target.value })} />}</Field>
          <Field label="Example sentence (optional)">{(p) => <Textarea {...p} rows={2} value={f.example} onChange={(e) => setF({ ...f, example: e.target.value })} />}</Field>
          <Field label="Collocation (optional)">{(p) => <Input {...p} value={f.collocation} onChange={(e) => setF({ ...f, collocation: e.target.value })} />}</Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button busy={busy} disabled={f.term.trim().length < 1} onClick={create}>Save</Button></div>
        </div>
      </Dialog>
    </>
  );
}
