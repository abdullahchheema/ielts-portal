'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Button, Card, Empty, FileInput, PageHeader, Select, Table, Td } from '@/components/ui';
import { AudioAttach, SectionImageAttach } from '@/components/question-bank-uploads';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface ImportOption { label: string; isCorrect: boolean }
interface ImportAnswerKey { value?: string; accepted?: string[]; correctOrder?: string[]; numericValue?: number }
interface ImportQuestion { ieltsType: string; prompt: { text: string }; options?: ImportOption[]; answerKey?: ImportAnswerKey }
interface ImportContentBlock { type: string }
interface ImportSection { title: string; instructions?: string; passage?: string; questions: ImportQuestion[]; contentBlocks?: ImportContentBlock[] }
interface ImportSet { title: string; skill: string; questions?: ImportQuestion[]; sections?: ImportSection[] }
interface ImportPayload { sets: ImportSet[] }

interface PreviewIssue { questionIndex: number; path: string; message: string }
interface PreviewDuplicate { questionIndex: number; matchedQuestionId: string; matchedPrompt: string }
interface PreviewSet { setIndex: number; title: string; questionCount: number; issues: PreviewIssue[]; duplicates: PreviewDuplicate[] }
interface PreviewResult { sets: PreviewSet[]; totalQuestions: number; totalIssues: number; totalDuplicates: number }
interface CommitResult { created: { setId: string; title: string; questionCount: number }[] }

/** A set's sections, normalised: a single-passage set (no `sections[]`) is treated as one implicit
 *  section so the preview and media-upload steps don't need two code paths. */
function sectionsOf(set: ImportSet): ImportSection[] {
  return set.sections ?? [{ title: set.title, questions: set.questions ?? [] }];
}

export default function ImportPage() {
  const [raw, setRaw] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ImportPayload | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState<'draft' | 'publish' | null>(null);
  const [moduleFilter, setModuleFilter] = useState('ALL');

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = () => { setRaw(String(reader.result ?? '')); setPreview(null); setCommitResult(null); setPayload(null); setError(null); setParseError(null); };
    reader.readAsText(f);
  }

  function parsed(): ImportPayload | null {
    setParseError(null);
    try {
      const v = JSON.parse(raw);
      if (typeof v !== 'object' || v === null || !Array.isArray((v as { sets?: unknown }).sets)) {
        setParseError('The file must be a JSON object with a top-level "sets" array.');
        return null;
      }
      return v as ImportPayload;
    } catch {
      setParseError('That is not valid JSON.');
      return null;
    }
  }

  async function runPreview() {
    const body = parsed();
    if (!body) return;
    setPayload(body);
    setModuleFilter('ALL');
    setPreviewBusy(true); setError(null); setCommitResult(null);
    try {
      setPreview(await api<PreviewResult>('/admin/question-sets/import/preview', { method: 'POST', body }));
    } catch (e) { setError(errorMessage(e)); } finally { setPreviewBusy(false); }
  }

  /** Creates every set as DRAFT (`publish: false`), or creates them and immediately pushes each
   *  through to PUBLISHED, student-facing (`publish: true`) — no separate Approve click either way,
   *  the backend's required DRAFT -> APPROVED -> PUBLISHED transition just happens in one request. */
  async function save(publish: boolean) {
    const body = parsed();
    if (!body) return;
    setSaveBusy(publish ? 'publish' : 'draft'); setError(null);
    try {
      const result = await api<CommitResult>('/admin/question-sets/import/commit', { method: 'POST', body });
      if (publish) {
        await Promise.all(result.created.map(async (c) => {
          await api(`/admin/question-sets/${c.setId}/status`, { method: 'POST', body: { status: 'APPROVED', studentFacing: false } });
          await api(`/admin/question-sets/${c.setId}/status`, { method: 'POST', body: { status: 'PUBLISHED', studentFacing: true } });
        }));
      }
      setCommitResult(result);
      setPreview(null);
    } catch (e) { setError(errorMessage(e)); } finally { setSaveBusy(null); }
  }

  const canSave = preview !== null && preview.totalIssues === 0;
  const visibleSets = payload ? (moduleFilter === 'ALL' ? payload.sets : payload.sets.filter((s) => s.title === moduleFilter)) : [];

  return (
    <>
      <PageHeader
        title="Bulk import"
        subtitle="Upload a JSON file of question sets, preview exactly what will be created, then save as a draft or publish it immediately."
        breadcrumbs={[{ href: '/admin/question-bank', label: 'Question bank' }, { label: 'Bulk import' }]}
      />

      <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
        <div>
          <label className="mb-1 block text-sm font-medium">JSON file</label>
          <FileInput accept="application/json,.json" file={file} onChange={onFile} />
        </div>
        {parseError && <Alert>{parseError}</Alert>}
        {error && <Alert>{error}</Alert>}
        <Button onClick={runPreview} busy={previewBusy} disabled={!raw.trim()}>Preview</Button>
      </div>

      {preview && payload && (
        <div className="mt-6 space-y-5">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span>{preview.sets.length} set(s)</span>
            <span>{preview.totalQuestions} question(s)</span>
            <span className={preview.totalIssues > 0 ? 'text-danger' : 'text-success'}>{preview.totalIssues} issue(s)</span>
            <span className={preview.totalDuplicates > 0 ? 'text-warning' : ''}>{preview.totalDuplicates} possible duplicate(s)</span>
          </div>

          {preview.sets.some((s) => s.issues.length > 0) && (
            <Table head={['Set', 'Questions', 'Issues', 'Duplicates']}>
              {preview.sets.map((s) => (
                <tr key={s.setIndex}>
                  <Td>{s.title}</Td>
                  <Td>{s.questionCount}</Td>
                  <Td>
                    {s.issues.length === 0 ? <span className="text-success">None</span> : (
                      <ul className="list-disc pl-4 text-sm text-danger">
                        {s.issues.map((i, idx) => <li key={idx}>Q{i.questionIndex + 1}: {i.message}</li>)}
                      </ul>
                    )}
                  </Td>
                  <Td>
                    {s.duplicates.length === 0 ? '—' : (
                      <ul className="list-disc pl-4 text-sm text-warning">
                        {s.duplicates.map((d, idx) => <li key={idx}>Q{d.questionIndex + 1} matches an existing question: &ldquo;{d.matchedPrompt.slice(0, 60)}&rdquo;</li>)}
                      </ul>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          {!canSave && preview.totalIssues > 0 && <Alert>Fix the flagged issues before saving. Duplicates are warnings only and do not block it.</Alert>}

          {canSave && (
            <>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium" htmlFor="module-filter">Viewing</label>
                <Select id="module-filter" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
                  <option value="ALL">All modules</option>
                  {payload.sets.map((s) => <option key={s.title} value={s.title}>{s.title}</option>)}
                </Select>
              </div>
              <div className="space-y-4">
                {visibleSets.map((s, i) => <SetContentPreview key={i} set={s} />)}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => save(false)} busy={saveBusy === 'draft'} disabled={!!saveBusy}>
                  Save as draft ({preview.totalQuestions} questions)
                </Button>
                <Button onClick={() => save(true)} busy={saveBusy === 'publish'} disabled={!!saveBusy}>
                  Publish ({preview.totalQuestions} questions)
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {commitResult && (
        <div className="mt-6 space-y-4">
          <Alert kind="success">Saved {commitResult.created.length} set(s).</Alert>
          {commitResult.created.length === 0 ? <Empty title="Nothing was created" /> : commitResult.created.map((c) => (
            <Card key={c.setId} className="space-y-3">
              <div className="flex items-center justify-between">
                <Link href={`/admin/question-bank/${c.setId}`} className="font-medium text-primary hover:underline">{c.title}</Link>
                <span className="text-sm text-fg-muted">{c.questionCount} question(s)</span>
              </div>
              <SetMediaUploads setId={c.setId} srcSet={payload?.sets.find((s) => s.title === c.title)} />
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

/** Read-only content view built straight from the uploaded JSON — no round trip needed, since the
 *  admin already has the full payload in the browser. Lets them actually read every question before
 *  committing, instead of trusting a bare pass/fail count. */
function SetContentPreview({ set }: { set: ImportSet }) {
  const sections = sectionsOf(set);
  const total = sections.reduce((n, s) => n + s.questions.length, 0);
  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-fg">{set.title}</h3>
        <span className="text-xs text-fg-muted">{set.skill} · {total} question(s)</span>
      </div>
      <div className="space-y-4">
        {sections.map((sec, i) => (
          <div key={i} className="space-y-2 rounded-md bg-surface-muted/40 p-3">
            {sections.length > 1 && <p className="text-sm font-semibold text-fg">{sec.title}</p>}
            {sec.instructions && <p className="text-xs text-fg-muted">{sec.instructions}</p>}
            {sec.passage && <p className="max-h-32 overflow-auto rounded bg-surface p-2 text-xs whitespace-pre-wrap text-fg-muted">{sec.passage}</p>}
            <ol className="space-y-1.5">
              {sec.questions.map((q, qi) => (
                <li key={qi} className="rounded bg-surface px-2.5 py-1.5 text-sm">
                  <span className="mr-2 text-xs text-fg-subtle">{qi + 1}.</span>
                  <span className="font-medium text-fg">{q.prompt.text}</span>
                  <span className="ml-2 text-xs text-fg-subtle">({q.ieltsType})</span>
                  {q.options?.length ? (
                    <ul className="mt-1 ml-5 list-disc text-xs text-fg-muted">
                      {q.options.map((o, oi) => <li key={oi} className={o.isCorrect ? 'font-medium text-success' : undefined}>{o.label}{o.isCorrect ? ' ✓' : ''}</li>)}
                    </ul>
                  ) : q.answerKey ? (
                    <p className="mt-0.5 ml-5 text-xs text-fg-muted">Answer: {q.answerKey.value ?? (q.answerKey.accepted ?? []).join(' / ') ?? ''}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Audio/image upload for a just-created set, inline on the import results screen — the whole point
 *  being nobody has to leave this page and go find the set to finish setting it up. Only renders
 *  controls that are actually relevant: audio for Listening, images for any section whose
 *  contentBlocks reference one. */
function SetMediaUploads({ setId, srcSet }: { setId: string; srcSet?: ImportSet }) {
  const [moduleAudioDone, setModuleAudioDone] = useState(false);
  const [sectionDone, setSectionDone] = useState<Record<number, { audio?: boolean; image?: boolean }>>({});
  if (!srcSet) return null;
  const isListening = srcSet.skill === 'LISTENING';
  const sections = srcSet.sections;
  const anySectionNeedsImage = sections?.some((s) => s.contentBlocks?.some((b) => b.type === 'image'));
  if (!isListening && !anySectionNeedsImage) return null;

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="text-xs font-semibold text-fg-muted">Media for this module</p>
      {isListening && !sections && (
        <div>
          <p className="mb-1 text-xs text-fg-muted">Audio for the whole module</p>
          <AudioAttach setId={setId} editable attached={moduleAudioDone} onDone={() => { setModuleAudioDone(true); }} />
        </div>
      )}
      {sections?.map((sec, i) => {
        const needsImage = sec.contentBlocks?.some((b) => b.type === 'image');
        if (!isListening && !needsImage) return null;
        return (
          <div key={i} className="space-y-2 rounded-md bg-surface-muted/40 p-3">
            <p className="text-xs font-medium text-fg-muted">{sec.title}</p>
            {isListening && (
              <AudioAttach setId={setId} sectionIndex={i} editable attached={!!sectionDone[i]?.audio}
                onDone={() => setSectionDone((d) => ({ ...d, [i]: { ...d[i], audio: true } }))} />
            )}
            {needsImage && (
              <div>
                <SectionImageAttach setId={setId} sectionIndex={i} onDone={() => setSectionDone((d) => ({ ...d, [i]: { ...d[i], image: true } }))} />
                {sectionDone[i]?.image && <p className="mt-1 text-xs text-success">Image attached.</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
