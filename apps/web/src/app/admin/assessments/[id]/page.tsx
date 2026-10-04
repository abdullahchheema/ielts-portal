'use client';

import { useConfirm } from '@/components/ui';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Field, Input, Loading, PageHeader, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { label } from '@/lib/format';

interface Assessment { id: string; title: string; type: string; skill: string | null; maxAttempts: number | null; timeLimitMin: number | null; passPercent: number; showAnswers: boolean; versions: { id: string; version: number; publishedAt: string | null }[] }
interface Question { id: string; type: string; prompt: { text: string }; marks: string | number; answerKey: { value?: string; accepted?: string[] } | null; options: { id: string; label: string; isCorrect: boolean }[] }
interface Section { id: string; title: string; content: { passage?: string; instructions?: string; audioKey?: string } | null; questions: Question[] }
interface Version { id: string; version: number; publishedAt: string | null; sections: Section[] }

const QTYPES: [string, string][] = [['MCQ_SINGLE', 'Multiple choice (one answer)'], ['MCQ_MULTI', 'Multiple choice (several answers)'], ['TFNG', 'True / False / Not Given'], ['YNNG', 'Yes / No / Not Given'], ['MATCHING', 'Matching (choose from a list)'], ['COMPLETION', 'Completion / short answer']];

function SectionDialog({ open, onClose, versionId, section, onSaved }: { open: boolean; onClose: () => void; versionId: string; section: Section | null; onSaved: () => void }) {
  const [f, setF] = useState({ title: '', passage: '', instructions: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setF({ title: section?.title ?? '', passage: section?.content?.passage ?? '', instructions: section?.content?.instructions ?? '' }); } }, [open, section]);
  const m = useMutation({
    mutationFn: () => {
      const body = { title: f.title, content: { passage: f.passage || undefined, instructions: f.instructions || undefined } };
      return section ? api('/admin/assessment-sections/' + section.id, { method: 'PATCH', body }) : api('/admin/assessment-versions/' + versionId + '/sections', { method: 'POST', body });
    },
    onSuccess: () => { onSaved(); onClose(); }, onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onClose={onClose} title={section ? 'Edit section' : 'New section'}>
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <Field label="Title">{(p) => <Input {...p} placeholder="Part 1 / Passage 1" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Instructions">{(p) => <Textarea {...p} rows={2} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />}</Field>
        <Field label="Reading passage (optional)">{(p) => <Textarea {...p} rows={8} value={f.passage} onChange={(e) => setF({ ...f, passage: e.target.value })} />}</Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={m.isPending} disabled={!f.title.trim()} onClick={() => m.mutate()}>Save</Button></div>
      </div>
    </Dialog>
  );
}

function QuestionDialog({ open, onClose, sectionId, question, onSaved }: { open: boolean; onClose: () => void; sectionId: string; question: Question | null; onSaved: () => void }) {
  const [type, setType] = useState('MCQ_SINGLE');
  const [text, setText] = useState('');
  const [marks, setMarks] = useState('1');
  const [options, setOptions] = useState<{ label: string; isCorrect: boolean }[]>([{ label: '', isCorrect: true }, { label: '', isCorrect: false }, { label: '', isCorrect: false }]);
  const [value, setValue] = useState('TRUE');
  const [accepted, setAccepted] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (question) {
      setType(question.type); setText(question.prompt.text); setMarks(String(Number(question.marks)));
      setOptions(question.options.length ? question.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })) : [{ label: '', isCorrect: true }, { label: '', isCorrect: false }]);
      setValue(question.answerKey?.value ?? 'TRUE'); setAccepted((question.answerKey?.accepted ?? []).join('\n'));
    } else { setType('MCQ_SINGLE'); setText(''); setMarks('1'); setOptions([{ label: '', isCorrect: true }, { label: '', isCorrect: false }, { label: '', isCorrect: false }]); setValue('TRUE'); setAccepted(''); }
  }, [open, question]);

  const usesOptions = ['MCQ_SINGLE', 'MCQ_MULTI', 'MATCHING'].includes(type);
  const m = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { type, prompt: { text }, marks: Number(marks) };
      if (usesOptions) body.options = options.filter((o) => o.label.trim());
      if (type === 'TFNG' || type === 'YNNG') body.answerKey = { value: type === 'YNNG' && ['TRUE', 'FALSE'].includes(value) ? (value === 'TRUE' ? 'YES' : 'NO') : value };
      if (type === 'COMPLETION') body.answerKey = { accepted: accepted.split('\n').map((x) => x.trim()).filter(Boolean) };
      return question ? api('/admin/assessment-questions/' + question.id, { method: 'PATCH', body }) : api('/admin/assessment-sections/' + sectionId + '/questions', { method: 'POST', body });
    },
    onSuccess: () => { onSaved(); onClose(); }, onError: (e) => setError(errorMessage(e)),
  });
  const single = type !== 'MCQ_MULTI';
  const setCorrect = (i: number, on: boolean) => setOptions((os) => os.map((o, j) => (single ? { ...o, isCorrect: j === i } : j === i ? { ...o, isCorrect: on } : o)));

  return (
    <Dialog open={open} onClose={onClose} title={question ? 'Edit question' : 'New question'}>
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2"><Field label="Type">{(p) => <Select {...p} value={type} disabled={!!question} onChange={(e) => { setType(e.target.value); setValue(e.target.value === 'YNNG' ? 'YES' : 'TRUE'); }}>{QTYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field></div>
          <Field label="Marks">{(p) => <Input {...p} type="number" min={0.5} step={0.5} value={marks} onChange={(e) => setMarks(e.target.value)} />}</Field>
        </div>
        <Field label="Question">{(p) => <Textarea {...p} rows={2} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
        {usesOptions && (
          <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium text-fg">Options — mark the correct {single ? 'one' : 'ones'}</legend>
            {options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <input aria-label={`Option ${i + 1} is correct`} type={single ? 'radio' : 'checkbox'} name="correct" checked={o.isCorrect} onChange={(e) => setCorrect(i, e.target.checked)} />
                <Input aria-label={`Option ${i + 1} text`} value={o.label} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <button type="button" className="text-sm text-danger disabled:opacity-40" disabled={options.length <= 2} onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label={`Remove option ${i + 1}`}>✕</button>
              </div>
            ))}
            {options.length < 12 && <Button type="button" variant="ghost" className="!py-1" onClick={() => setOptions([...options, { label: '', isCorrect: false }])}>+ Add option</Button>}
          </fieldset>
        )}
        {(type === 'TFNG' || type === 'YNNG') && (
          <Field label="Correct answer">{(p) => <Select {...p} value={value} onChange={(e) => setValue(e.target.value)}>{(type === 'TFNG' ? ['TRUE', 'FALSE', 'NOT_GIVEN'] : ['YES', 'NO', 'NOT_GIVEN']).map((v) => <option key={v} value={v}>{label(v)}</option>)}</Select>}</Field>
        )}
        {type === 'COMPLETION' && <Field label="Accepted answers" hint="One per line. Case, spacing and end punctuation are ignored.">{(p) => <Textarea {...p} rows={3} value={accepted} onChange={(e) => setAccepted(e.target.value)} />}</Field>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={m.isPending} disabled={!text.trim()} onClick={() => m.mutate()}>Save question</Button></div>
      </div>
    </Dialog>
  );
}

export default function AssessmentBuilderPage() {
  const confirm = useConfirm();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [versionId, setVersionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secDlg, setSecDlg] = useState<{ open: boolean; section: Section | null }>({ open: false, section: null });
  const [qDlg, setQDlg] = useState<{ open: boolean; sectionId: string; question: Question | null }>({ open: false, sectionId: '', question: null });

  const a = useQuery({ queryKey: ['admin-assessment', id], queryFn: () => api<Assessment>('/admin/assessments/' + id) });
  const current = versionId ?? a.data?.versions[0]?.id ?? null;
  const v = useQuery({ queryKey: ['admin-assessment-version', current], queryFn: () => api<Version>('/admin/assessment-versions/' + current), enabled: !!current });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-assessment-version', current] }); };
  const refreshAll = () => { qc.invalidateQueries({ queryKey: ['admin-assessment', id] }); qc.invalidateQueries({ queryKey: ['admin-assessments'] }); refresh(); };
  const run = async (fn: () => Promise<unknown>, after: () => void = refresh) => { setError(null); try { await fn(); after(); } catch (e) { setError(errorMessage(e)); } };

  if (a.isLoading) return <Loading />;
  if (a.isError || !a.data) return <Alert>Assessment not found.</Alert>;
  const asm = a.data;
  const draft = v.data && !v.data.publishedAt;
  const total = v.data?.sections.reduce((n, s) => n + s.questions.length, 0) ?? 0;

  return (
    <>
      <PageHeader title={asm.title} subtitle={`${label(asm.type)}${asm.skill ? ' · ' + label(asm.skill) : ''}${asm.timeLimitMin ? ' · ' + asm.timeLimitMin + ' min' : ''}${asm.maxAttempts ? ' · ' + asm.maxAttempts + ' attempts' : ''}${asm.passPercent ? ' · pass ' + asm.passPercent + '%' : ''}`} />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="ver" className="text-sm font-medium text-fg">Version</label>
          <Select id="ver" className="!w-auto" value={current ?? ''} onChange={(e) => setVersionId(e.target.value)}>{asm.versions.map((x) => <option key={x.id} value={x.id}>v{x.version} — {x.publishedAt ? 'Published' : 'Draft'}</option>)}</Select>
          {v.data && <Badge status={v.data.publishedAt ? 'PUBLISHED' : 'DRAFT'} />}<span className="text-sm text-fg-muted">{total} question{total === 1 ? '' : 's'}</span>
          <div className="ml-auto flex gap-2">
            {!asm.versions.some((x) => !x.publishedAt) && <Button variant="secondary" onClick={() => run(async () => { const n = await api<{ id: string }>('/admin/assessments/' + id + '/versions', { method: 'POST' }); setVersionId(n.id); }, refreshAll)}>New version (copy)</Button>}
            {draft && <Button onClick={() => confirm({ message: 'Publish this version? It becomes read-only and new attempts will use it.', confirmLabel: 'Publish' }).then((ok) => { if (ok) { run(() => api('/admin/assessment-versions/' + current + '/publish', { method: 'POST' }), refreshAll); } })}>Publish version</Button>}
          </div>
        </div>
        {v.data?.publishedAt && <p className="mt-3 text-sm text-fg-muted">Published versions are frozen so past scores stay reproducible. Create a new version to change questions.</p>}
      </Card>

      {v.isLoading && <Loading />}
      {v.data && (
        <>
          {draft && <div className="mb-4"><Button variant="secondary" onClick={() => setSecDlg({ open: true, section: null })}>+ Section</Button></div>}
          <div className="space-y-4">
            {v.data.sections.map((s) => (
              <Card key={s.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><h2 className="font-semibold">{s.title}</h2>{s.content?.instructions && <p className="text-sm text-fg-muted">{s.content.instructions}</p>}{s.content?.passage && <p className="text-xs text-fg-muted">Passage: {s.content.passage.length} characters</p>}{s.content?.audioKey && <p className="text-xs text-green-700">🔊 Audio attached</p>}</div>
                  {draft && (
                    <div className="flex flex-wrap gap-1 text-xs">
                      <label className="cursor-pointer rounded-md px-2 py-1 text-primary hover:bg-surface-muted">{s.content?.audioKey ? 'Replace audio' : 'Upload audio (MP3)'}
                        <input type="file" accept="audio/mpeg" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const fd = new FormData(); fd.append('file', file); run(() => api('/admin/assessment-sections/' + s.id + '/audio', { method: 'POST', form: fd })); e.target.value = ''; }} />
                      </label>
                      <Button variant="ghost" className="!px-2 !py-1" onClick={() => setSecDlg({ open: true, section: s })}>Edit</Button>
                      <Button variant="ghost" className="!px-2 !py-1" onClick={() => setQDlg({ open: true, sectionId: s.id, question: null })}>+ Question</Button>
                      <Button variant="ghost" tone="danger" className="!px-2 !py-1" onClick={() => confirm({ message: 'Delete this section and its questions?', tone: 'danger', confirmLabel: 'Delete section' }).then((ok) => { if (ok) { run(() => api('/admin/assessment-sections/' + s.id, { method: 'DELETE' })); } })}>Delete</Button>
                    </div>
                  )}
                </div>
                <ol className="mt-3 divide-y divide-border text-sm">
                  {s.questions.map((q, i) => (
                    <li key={q.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                      <div><p><span className="mr-2 text-fg-subtle">{i + 1}.</span>{q.prompt.text} <span className="text-xs text-fg-muted">· {label(q.type)} · {Number(q.marks)} mark{Number(q.marks) === 1 ? '' : 's'}</span></p>
                        <p className="ml-5 text-xs text-green-700">Answer: {q.options.length ? q.options.filter((o) => o.isCorrect).map((o) => o.label).join(', ') : q.answerKey?.value ? label(q.answerKey.value) : q.answerKey?.accepted?.join(' / ')}</p></div>
                      {draft && <span className="flex gap-1 text-xs"><Button variant="ghost" className="!px-2 !py-1" onClick={() => setQDlg({ open: true, sectionId: s.id, question: q })}>Edit</Button><Button variant="ghost" tone="danger" className="!px-2 !py-1" onClick={() => confirm({ message: 'Delete this question?', tone: 'danger', confirmLabel: 'Delete question' }).then((ok) => { if (ok) { run(() => api('/admin/assessment-questions/' + q.id, { method: 'DELETE' })); } })}>Delete</Button></span>}
                    </li>
                  ))}
                  {s.questions.length === 0 && <li className="py-2 text-fg-muted">No questions yet.</li>}
                </ol>
              </Card>
            ))}
            {v.data.sections.length === 0 && <Alert kind="info">Add a section (for example “Part 1” or “Passage 1”), then add questions to it.</Alert>}
          </div>
        </>
      )}
      {current && <SectionDialog open={secDlg.open} onClose={() => setSecDlg({ open: false, section: null })} versionId={current} section={secDlg.section} onSaved={refresh} />}
      <QuestionDialog open={qDlg.open} onClose={() => setQDlg((d) => ({ ...d, open: false }))} sectionId={qDlg.sectionId} question={qDlg.question} onSaved={refresh} />
    </>
  );
}
