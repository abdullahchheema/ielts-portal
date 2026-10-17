'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Button, Empty, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface PreviewIssue { questionIndex: number; path: string; message: string }
interface PreviewDuplicate { questionIndex: number; matchedQuestionId: string; matchedPrompt: string }
interface PreviewSet { setIndex: number; title: string; questionCount: number; issues: PreviewIssue[]; duplicates: PreviewDuplicate[] }
interface PreviewResult { sets: PreviewSet[]; totalQuestions: number; totalIssues: number; totalDuplicates: number }
interface CommitResult { created: { setId: string; title: string; questionCount: number }[] }

export default function ImportPage() {
  const [raw, setRaw] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setRaw(String(reader.result ?? '')); setPreview(null); setCommitResult(null); setError(null); setParseError(null); };
    reader.readAsText(file);
  }

  function parsed(): object | null {
    setParseError(null);
    try {
      const v = JSON.parse(raw);
      if (typeof v !== 'object' || v === null || !Array.isArray((v as { sets?: unknown }).sets)) {
        setParseError('The file must be a JSON object with a top-level "sets" array.');
        return null;
      }
      return v;
    } catch {
      setParseError('That is not valid JSON.');
      return null;
    }
  }

  async function runPreview() {
    const body = parsed();
    if (!body) return;
    setBusy(true); setError(null); setCommitResult(null);
    try {
      setPreview(await api<PreviewResult>('/admin/question-sets/import/preview', { method: 'POST', body }));
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function runCommit() {
    const body = parsed();
    if (!body) return;
    setBusy(true); setError(null);
    try {
      setCommitResult(await api<CommitResult>('/admin/question-sets/import/commit', { method: 'POST', body }));
      setPreview(null);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  const canCommit = preview !== null && preview.totalIssues === 0;

  return (
    <>
      <PageHeader title="Bulk import" subtitle="Upload a JSON file of question sets, preview the result, then commit. Imported sets land as DRAFT and still need review before publishing." />

      <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
        <div>
          <label className="mb-1 block text-sm font-medium">JSON file</label>
          <input type="file" accept="application/json,.json" onChange={onFile} className="block w-full text-sm" />
        </div>
        {parseError && <Alert>{parseError}</Alert>}
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2">
          <Button onClick={runPreview} busy={busy} disabled={!raw.trim()}>Preview</Button>
          <Button onClick={runCommit} busy={busy} disabled={!canCommit} variant={canCommit ? 'primary' : 'secondary'}>
            Commit {preview ? `(${preview.totalQuestions} questions)` : ''}
          </Button>
        </div>
      </div>

      {preview && (
        <div className="mt-6 space-y-4">
          <div className="flex gap-4 text-sm">
            <span>{preview.sets.length} set(s)</span>
            <span>{preview.totalQuestions} question(s)</span>
            <span className={preview.totalIssues > 0 ? 'text-danger' : 'text-success'}>{preview.totalIssues} issue(s)</span>
            <span className={preview.totalDuplicates > 0 ? 'text-warning' : ''}>{preview.totalDuplicates} possible duplicate(s)</span>
          </div>
          {preview.sets.length === 0 ? <Empty title="Nothing to import" /> : (
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
          {!canCommit && preview.totalIssues > 0 && <Alert>Fix the flagged issues before committing. Duplicates are warnings only and do not block the import.</Alert>}
        </div>
      )}

      {commitResult && (
        <div className="mt-6 space-y-2">
          <Alert kind="success">Imported {commitResult.created.length} set(s) as drafts.</Alert>
          <ul className="list-disc pl-4 text-sm">
            {commitResult.created.map((c) => (
              <li key={c.setId}>
                <Link href={`/admin/question-bank/${c.setId}`} className="text-primary hover:underline">{c.title}</Link> — {c.questionCount} question(s)
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
