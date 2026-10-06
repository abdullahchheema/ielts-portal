'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Empty, Field, Input, Loading, PageHeader, Select, Textarea, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface Option { label: string; isCorrect: boolean }
interface Question {
  id: string; ieltsType: string | null; questionType: string;
  versions: { version: number; prompt: { text: string }; marks: string; answerKey: { value?: string; accepted?: string[] } | null; options: Option[] }[];
}
interface SetDetail {
  id: string; title: string; skill: string; module: string; topic: string | null; difficulty: number; status: string; studentFacing: boolean;
  version: number; stimulus: { passage?: string } | null; questions: Question[];
}

const ITEM_TYPES = ['MCQ_SINGLE', 'MCQ_MULTI', 'TFNG', 'YNNG', 'MATCHING_HEADINGS', 'MATCHING_INFORMATION', 'MAP_LABELLING', 'SENTENCE_COMPLETION', 'SUMMARY_COMPLETION', 'NOTE_COMPLETION', 'TABLE_COMPLETION', 'FORM_COMPLETION', 'WRITING_TASK1', 'WRITING_TASK2', 'SPEAKING_PART1', 'SPEAKING_PART2', 'SPEAKING_PART3'];
const NEXT: Record<string, string[]> = { DRAFT: ['APPROVED', 'ARCHIVED'], APPROVED: ['DRAFT', 'PUBLISHED', 'ARCHIVED'], PUBLISHED: ['ARCHIVED'], ARCHIVED: [] };
const LABEL: Record<string, string> = { APPROVED: 'Approve', DRAFT: 'Return to draft', PUBLISHED: 'Publish', ARCHIVED: 'Archive' };

export default function QuestionSetPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading, isError } = useQuery({ queryKey: ['question-set', id], queryFn: () => api<SetDetail>(`/admin/question-sets/${id}`) });
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['question-set', id] }), qc.invalidateQueries({ queryKey: ['question-sets'] })]);

  async function move(status: string) {
    setError(null);
    let studentFacing = false;
    if (status === 'PUBLISHED') {
      const ok = await confirm({ message: 'Make this set visible to students in practice? You can change this later by archiving it.', confirmLabel: 'Publish for students' });
      if (!ok) return;
      studentFacing = true;
    }
    try {
      await api(`/admin/question-sets/${id}/status`, { method: 'POST', body: { status, studentFacing } });
      await refresh();
    } catch (e) { setError(errorMessage(e)); }
  }
  async function clone() {
    try {
      const copy = await api<{ id: string }>(`/admin/question-sets/${id}/clone`, { method: 'POST' });
      window.location.href = `/admin/question-bank/${copy.id}`;
    } catch (e) { setError(errorMessage(e)); }
  }
  async function removeQuestion(qid: string) {
    if (!(await confirm({ message: 'Remove this question from the set?', confirmLabel: 'Remove' }))) return;
    try { await api(`/admin/question-sets/questions/${qid}`, { method: 'DELETE' }); await refresh(); } catch (e) { setError(errorMessage(e)); }
  }

  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>Could not load this set.</Alert>;
  const editable = data.status === 'DRAFT' || data.status === 'APPROVED';

  return (
    <>
      <PageHeader
        title={data.title}
        subtitle={`${data.skill} · ${data.module.toLowerCase()} · topic ${data.topic ?? '—'} · difficulty ${data.difficulty}/5 · v${data.version}`}
        actions={<div className="flex flex-wrap gap-2">
          <Badge status={data.status} />
          {data.studentFacing && <Badge status="PUBLISHED" tone="green" text="Student-facing" />}
          {(NEXT[data.status] ?? []).map((s) => <Button key={s} variant={s === 'PUBLISHED' ? 'primary' : 'secondary'} onClick={() => move(s)}>{LABEL[s]}</Button>)}
          {!editable && <Button variant="secondary" onClick={clone}>Clone to edit</Button>}
        </div>}
      />
      {error && <Alert>{error}</Alert>}
      {data.stimulus?.passage && (
        <Card className="mb-4"><h3 className="mb-2 font-semibold">Passage</h3><p className="whitespace-pre-wrap text-sm text-fg">{data.stimulus.passage}</p></Card>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-fg">Questions ({data.questions.length})</h2>
        {editable && <Button onClick={() => setAdding(true)}>Add question</Button>}
      </div>
      {data.questions.length === 0 ? <Empty title="No questions yet">Add questions before approving or publishing this set.</Empty> : (
        <ol className="space-y-3">
          {data.questions.map((q, i) => {
            const v = q.versions[0];
            return (
              <Card key={q.id} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm"><span className="mr-2 font-medium text-fg-muted">{i + 1}.</span>{v?.prompt.text}</p>
                  {editable && <Button variant="ghost" className="!py-1" onClick={() => removeQuestion(q.id)}>Remove</Button>}
                </div>
                <p className="text-xs text-fg-subtle">{q.ieltsType?.replace(/_/g, ' ').toLowerCase()} · {v?.marks} mark(s) · version {v?.version}</p>
                {v?.options.length > 0 && (
                  <ul className="text-sm text-fg-muted">{v.options.map((o) => <li key={o.label} className={o.isCorrect ? 'font-medium text-success' : ''}>{o.isCorrect ? '✓ ' : '• '}{o.label}</li>)}</ul>
                )}
                {v?.answerKey && <p className="text-xs text-fg-muted">Answer: {v.answerKey.value ?? (v.answerKey.accepted ?? []).join(' / ')}</p>}
              </Card>
            );
          })}
        </ol>
      )}

      {adding && <AddQuestion setId={id} onDone={async () => { setAdding(false); await refresh(); }} onClose={() => setAdding(false)} />}
    </>
  );
}

function AddQuestion({ setId, onDone, onClose }: { setId: string; onDone: () => void; onClose: () => void }) {
  const [f, setF] = useState({ ieltsType: 'TFNG', prompt: '', marks: '1', answer: 'TRUE', accepted: '', options: 'Option A | true\nOption B | false' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const grader = f.ieltsType.startsWith('MCQ') || f.ieltsType.startsWith('MATCHING') || f.ieltsType === 'MAP_LABELLING' ? 'OPTIONS' : f.ieltsType === 'TFNG' ? 'TFNG' : f.ieltsType === 'YNNG' ? 'YNNG' : f.ieltsType.includes('COMPLETION') || f.ieltsType === 'FORM_COMPLETION' ? 'COMPLETION' : 'NONE';

  async function save() {
    setBusy(true); setError(null);
    const body: Record<string, unknown> = { ieltsType: f.ieltsType, prompt: { text: f.prompt }, marks: Number(f.marks) };
    if (grader === 'TFNG' || grader === 'YNNG') body.answerKey = { value: f.answer };
    if (grader === 'COMPLETION') body.answerKey = { accepted: f.accepted.split(',').map((s) => s.trim()).filter(Boolean) };
    if (grader === 'OPTIONS') body.options = f.options.split('\n').map((line) => line.split('|')).filter((p) => p.length === 2).map(([label, ok]) => ({ label: label.trim(), isCorrect: ok.trim().toLowerCase() === 'true' }));
    try {
      await api(`/admin/question-sets/${setId}/questions`, { method: 'POST', body });
      await onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onClose={onClose} title="Add question">
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <Field label="Item type">{(p) => <Select {...p} value={f.ieltsType} onChange={(e) => setF({ ...f, ieltsType: e.target.value })}>{ITEM_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ').toLowerCase()}</option>)}</Select>}</Field>
        <Field label="Question or statement">{(p) => <Textarea {...p} rows={3} value={f.prompt} onChange={(e) => setF({ ...f, prompt: e.target.value })} />}</Field>
        <Field label="Marks">{(p) => <Input {...p} type="number" min={0.5} step={0.5} value={f.marks} onChange={(e) => setF({ ...f, marks: e.target.value })} />}</Field>
        {grader === 'TFNG' && <Field label="Correct answer">{(p) => <Select {...p} value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })}><option value="TRUE">True</option><option value="FALSE">False</option><option value="NOT_GIVEN">Not given</option></Select>}</Field>}
        {grader === 'YNNG' && <Field label="Correct answer">{(p) => <Select {...p} value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })}><option value="YES">Yes</option><option value="NO">No</option><option value="NOT_GIVEN">Not given</option></Select>}</Field>}
        {grader === 'COMPLETION' && <Field label="Accepted answers (separate alternatives with commas)">{(p) => <Input {...p} value={f.accepted} onChange={(e) => setF({ ...f, accepted: e.target.value })} />}</Field>}
        {grader === 'OPTIONS' && <Field label="Options (one per line: option text | true or false)">{(p) => <Textarea {...p} rows={4} value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} />}</Field>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} busy={busy} disabled={f.prompt.trim().length === 0}>Add question</Button>
        </div>
      </div>
    </Dialog>
  );
}
