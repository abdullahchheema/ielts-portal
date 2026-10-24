'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { IELTS_ITEM_TYPES, IeltsItemType, ITEM_TYPE_KEYS } from '@ielts/validation';
import { Accordion, Alert, Badge, Button, Card, Dialog, Empty, Field, FileInput, Input, Loading, PageHeader, Section, Select, Textarea, useConfirm } from '@/components/ui';
import { AudioAttach, QuestionImageAttach, SectionImageAttach } from '@/components/question-bank-uploads';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface Option { label: string; isCorrect: boolean }
interface QImage { id: string; url: string; altText: string | null }
interface Question {
  id: string; ieltsType: string | null; questionType: string; bankSectionIndex: number | null;
  versions: { version: number; prompt: { text: string }; marks: string; answerKey: { value?: string; accepted?: string[] } | null; options: Option[]; images: QImage[] }[];
}
interface StimulusSection { title: string; instructions?: string; passage?: string; audioKey?: string; audioUrl?: string; images?: QImage[] }
interface SetDetail {
  id: string; title: string; skill: string; module: string; topic: string | null; difficulty: number; status: string; studentFacing: boolean;
  createdAt: string;
  stimulus: { passage?: string; audioKey?: string; audioUrl?: string; sections?: StimulusSection[] } | null; questions: Question[];
}

const ITEM_TYPES = ITEM_TYPE_KEYS;

export default function QuestionSetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading, isError } = useQuery({ queryKey: ['question-set', id], queryFn: () => api<SetDetail>(`/admin/question-sets/${id}`) });
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleBusy, setTitleBusy] = useState(false);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['question-set', id] }), qc.invalidateQueries({ queryKey: ['question-sets'] })]);

  async function saveTitle() {
    const next = titleDraft.trim();
    if (next.length < 3) { setError('Title must be at least 3 characters.'); return; }
    setTitleBusy(true); setError(null);
    try {
      await api(`/admin/question-sets/${id}`, { method: 'PATCH', body: { title: next } });
      await refresh();
      setEditingTitle(false);
    } catch (e) { setError(errorMessage(e)); } finally { setTitleBusy(false); }
  }

  async function publish() {
    setError(null);
    const ok = await confirm({ message: 'Publish this set so students see it in practice and free tests?', confirmLabel: 'Publish' });
    if (!ok) return;
    setActionBusy('PUBLISHED');
    try {
      await api(`/admin/question-sets/${id}/status`, { method: 'POST', body: { status: 'PUBLISHED', studentFacing: true } });
      await refresh();
    } catch (e) { setError(errorMessage(e)); } finally { setActionBusy(null); }
  }
  async function unpublish() {
    const ok = await confirm({ message: 'Archive this set? Students will stop seeing it in practice and free tests.', confirmLabel: 'Archive', tone: 'danger' });
    if (!ok) return;
    setActionBusy('ARCHIVED');
    try {
      await api(`/admin/question-sets/${id}/status`, { method: 'POST', body: { status: 'ARCHIVED', studentFacing: false } });
      await refresh();
    } catch (e) { setError(errorMessage(e)); } finally { setActionBusy(null); }
  }
  async function duplicate() {
    setActionBusy('clone');
    try {
      const copy = await api<{ id: string }>(`/admin/question-sets/${id}/clone`, { method: 'POST' });
      router.push(`/admin/question-bank/${copy.id}`);
    } catch (e) { setError(errorMessage(e)); setActionBusy(null); }
  }
  async function removeQuestion(qid: string) {
    if (!(await confirm({ message: 'Remove this question from the set?', confirmLabel: 'Remove' }))) return;
    try { await api(`/admin/question-sets/questions/${qid}`, { method: 'DELETE' }); await refresh(); } catch (e) { setError(errorMessage(e)); }
  }
  async function remove() {
    if (!(await confirm({ message: 'Permanently delete this set and all of its questions? This cannot be undone.', confirmLabel: 'Delete set' }))) return;
    setActionBusy('delete');
    try {
      await api(`/admin/question-sets/${id}`, { method: 'DELETE' });
      router.push('/admin/question-bank');
    } catch (e) { setError(errorMessage(e)); setActionBusy(null); }
  }

  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>Could not load this set.</Alert>;
  // Everything short of ARCHIVED is directly editable, including PUBLISHED — a change to a live set
  // just invalidates its already-built free-test wrapper so the next pick rebuilds from the edit.
  const editable = data.status !== 'ARCHIVED';
  // A set is only actually visible to students once it's both PUBLISHED and studentFacing — a brand
  // new set lands PUBLISHED-but-hidden by default (no draft stage to build it in first), so "status"
  // alone isn't enough to decide which action to offer.
  const live = data.status === 'PUBLISHED' && data.studentFacing;

  return (
    <>
      <PageHeader
        title={data.title}
        subtitle={`${data.skill} · ${data.module.toLowerCase()} · topic ${data.topic ?? '—'} · difficulty ${data.difficulty}/5 · added ${date(data.createdAt)}`}
        breadcrumbs={[{ href: '/admin/question-bank', label: 'Question bank' }, { label: data.title }]}
        actions={<div className="flex flex-wrap gap-2">
          <Badge status={live ? 'PUBLISHED' : data.status === 'ARCHIVED' ? 'ARCHIVED' : 'PENDING'} tone={live ? 'green' : data.status === 'ARCHIVED' ? 'slate' : 'amber'} text={live ? 'Published' : data.status === 'ARCHIVED' ? 'Archived' : 'Published (hidden)'} />
          {editable && <Button variant="secondary" onClick={() => { setTitleDraft(data.title); setEditingTitle(true); }}>Edit title</Button>}
          <Link href={`/admin/question-bank/${id}/preview`}><Button variant="secondary">Preview</Button></Link>
          {!live && <Button onClick={publish} busy={actionBusy === 'PUBLISHED'} disabled={!!actionBusy}>{data.status === 'ARCHIVED' ? 'Republish' : 'Publish'}</Button>}
          {live && <Button variant="secondary" onClick={unpublish} busy={actionBusy === 'ARCHIVED'} disabled={!!actionBusy}>Archive</Button>}
          <Button variant="secondary" onClick={duplicate} busy={actionBusy === 'clone'} disabled={!!actionBusy}>Duplicate</Button>
          <Button variant="danger" onClick={remove} busy={actionBusy === 'delete'} disabled={!!actionBusy}>Delete</Button>
        </div>}
      />
      {error && <Alert>{error}</Alert>}

      <Dialog open={editingTitle} onClose={() => setEditingTitle(false)} title="Edit module title">
        <div className="space-y-4">
          <Field label="Title">{(p) => <Input {...p} value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); }} autoFocus />}</Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditingTitle(false)}>Cancel</Button>
            <Button onClick={saveTitle} busy={titleBusy}>Save</Button>
          </div>
        </div>
      </Dialog>

      {data.stimulus?.sections?.length && data.skill === 'LISTENING' && (
        <Section className="mb-4" title="Audio for the whole module">
          <p className="mb-2 text-xs text-fg-muted">Use this if one recording covers every part (the normal case for a real Listening test). Only use the per-part audio below if you have separate files per part instead.</p>
          <AudioAttach setId={id} editable={editable} attached={!!data.stimulus?.audioKey} audioUrl={data.stimulus?.audioUrl} onDone={refresh} />
        </Section>
      )}

      {data.stimulus?.sections?.length ? (
        data.stimulus.sections.map((sec, i) => (
          <Section key={i} className="mb-4" title={sec.title}>
            <div className="space-y-3">
              {sec.instructions && <p className="text-sm text-fg-muted">{sec.instructions}</p>}
              {sec.passage && <Accordion items={[{ key: 'passage', title: 'Passage', content: <p className="whitespace-pre-wrap text-sm text-fg">{sec.passage}</p> }]} defaultOpen="passage" />}
              {sec.images?.map((img) => <img key={img.id} src={img.url} alt={img.altText ?? ''} className="max-h-96 rounded-md ring-1 ring-border" />)}
              {editable && <SectionImageAttach setId={id} sectionIndex={i} onDone={refresh} />}
              {data.skill === 'LISTENING' && (
                <div>
                  <p className="mb-1 text-xs text-fg-subtle">Audio for this part only (leave empty if the whole-module recording above covers it)</p>
                  <AudioAttach setId={id} sectionIndex={i} editable={editable} attached={!!sec.audioKey} audioUrl={sec.audioUrl} onDone={refresh} />
                </div>
              )}
            </div>
          </Section>
        ))
      ) : (
        <>
          {data.stimulus?.passage && (
            <Section className="mb-4">
              <Accordion items={[{ key: 'passage', title: 'Passage', content: <p className="whitespace-pre-wrap text-sm text-fg">{data.stimulus.passage}</p> }]} defaultOpen="passage" />
            </Section>
          )}
          {data.skill === 'LISTENING' && (
            <Section className="mb-4" title="Audio">
              <AudioAttach setId={id} editable={editable} attached={!!data.stimulus?.audioKey} audioUrl={data.stimulus?.audioUrl} onDone={refresh} />
            </Section>
          )}
        </>
      )}

      {Array.from({ length: (data.stimulus?.sections?.length ?? 1) }).map((_, sectionIdx) => {
        const hasSections = !!data.stimulus?.sections?.length;
        const sectionQuestions = hasSections ? data.questions.filter((q) => q.bankSectionIndex === sectionIdx) : data.questions;
        const title = hasSections ? `${data.stimulus!.sections![sectionIdx].title} — questions` : `Questions (${data.questions.length})`;
        return (
          <Section key={sectionIdx} title={title} actions={editable && <Button onClick={() => setAdding(true)}>Add question</Button>}>
            {sectionQuestions.length === 0 ? <Empty title="No questions yet">Add questions before approving or publishing this set.</Empty> : (
              <ol className="space-y-3">
                {sectionQuestions.map((q, i) => {
                  const v = q.versions[0];
                  return (
                    <Card key={q.id} className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm"><span className="mr-2 font-medium text-fg-muted">{i + 1}.</span>{v?.prompt.text}</p>
                        {editable && <div className="flex shrink-0 gap-2">
                          <Button variant="ghost" size="xs" onClick={() => setEditingQuestion(q)}>Edit</Button>
                          <Button variant="ghost" size="xs" onClick={() => removeQuestion(q.id)}>Remove</Button>
                        </div>}
                      </div>
                      <p className="text-xs text-fg-subtle">{q.ieltsType?.replace(/_/g, ' ').toLowerCase()} · {v?.marks} mark(s) · version {v?.version}</p>
                      {v?.images.map((img) => <img key={img.id} src={img.url} alt={img.altText ?? ''} className="max-h-80 rounded-md ring-1 ring-border" />)}
                      {v?.options.length > 0 && (
                        <ul className="text-sm text-fg-muted">{v.options.map((o) => <li key={o.label} className={o.isCorrect ? 'font-medium text-success' : ''}>{o.isCorrect ? '✓ ' : '• '}{o.label}</li>)}</ul>
                      )}
                      {v?.answerKey && <p className="text-xs text-fg-muted">Answer: {v.answerKey.value ?? (v.answerKey.accepted ?? []).join(' / ')}</p>}
                      {editable && <QuestionImageAttach questionId={q.id} onDone={refresh} />}
                    </Card>
                  );
                })}
              </ol>
            )}
          </Section>
        );
      })}

      {adding && <QuestionForm setId={id} onDone={async () => { setAdding(false); await refresh(); }} onClose={() => setAdding(false)} />}
      {editingQuestion && (
        <QuestionForm setId={id} question={editingQuestion} onDone={async () => { setEditingQuestion(null); await refresh(); }} onClose={() => setEditingQuestion(null)} />
      )}
    </>
  );
}

/** Same form for adding a new question and editing an existing one — pass `question` to prefill and
 *  switch the submit to a PATCH (which creates a new version, same as hand-editing in the backend). */
function QuestionForm({ setId, question, onDone, onClose }: { setId: string; question?: Question; onDone: () => void; onClose: () => void }) {
  const editing = !!question;
  const v = question?.versions[0];
  const [f, setF] = useState(() => ({
    ieltsType: question?.ieltsType ?? 'TFNG',
    prompt: v?.prompt.text ?? '',
    marks: v?.marks ?? '1',
    answer: v?.answerKey?.value ?? 'TRUE',
    accepted: (v?.answerKey?.accepted ?? []).join(', '),
    options: v?.options.length ? v.options.map((o) => `${o.label} | ${o.isCorrect}`).join('\n') : 'Option A | true\nOption B | false',
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which editor to show: the real grader behind each item type, from the shared taxonomy, not re-derived from its name.
  const baseGrader = IELTS_ITEM_TYPES[f.ieltsType as IeltsItemType].grader;
  const grader = baseGrader === 'MCQ_SINGLE' || baseGrader === 'MCQ_MULTI' || baseGrader === 'MATCHING' ? 'OPTIONS' : baseGrader;

  async function save() {
    setBusy(true); setError(null);
    const body: Record<string, unknown> = { ieltsType: f.ieltsType, prompt: { text: f.prompt }, marks: Number(f.marks) };
    if (grader === 'TFNG' || grader === 'YNNG') body.answerKey = { value: f.answer };
    if (grader === 'COMPLETION') body.answerKey = { accepted: f.accepted.split(',').map((s) => s.trim()).filter(Boolean) };
    if (grader === 'OPTIONS') body.options = f.options.split('\n').map((line) => line.split('|')).filter((p) => p.length === 2).map(([label, ok]) => ({ label: label.trim(), isCorrect: ok.trim().toLowerCase() === 'true' }));
    try {
      if (editing) await api(`/admin/question-sets/questions/${question!.id}`, { method: 'PATCH', body });
      else await api(`/admin/question-sets/${setId}/questions`, { method: 'POST', body });
      await onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onClose={onClose} title={editing ? 'Edit question' : 'Add question'}>
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
          <Button onClick={save} busy={busy} disabled={f.prompt.trim().length === 0}>{editing ? 'Save changes' : 'Add question'}</Button>
        </div>
      </div>
    </Dialog>
  );
}
