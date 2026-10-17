'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Dialog, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface PoolStats { listening: number; reading: number; writing: number; speaking: number }
interface LeadRow {
  id: string; email: string; phone: string; status: string; stage: string | null; examStatus: string | null;
  overallEstimate: number | null; missingSkills: string[]; createdAt: string; linked: boolean;
}
interface ModuleRow { id: string; kind: 'ASSESSMENT' | 'QUESTION_SET'; skill: string; title: string; published: boolean; questionCount?: number; createdAt: string }
interface PreviewIssue { questionIndex: number; path: string; message: string }
interface PreviewSet { setIndex: number; title: string; questionCount: number; issues: PreviewIssue[]; duplicates: { questionIndex: number; matchedPrompt: string }[] }
interface PreviewResult { sets: PreviewSet[]; totalQuestions: number; totalIssues: number; totalDuplicates: number }
interface CommitResult { modules: { moduleId: string; kind: 'ASSESSMENT' | 'QUESTION_SET'; skill: string; title: string; questionCount: number; needsAudio?: boolean }[] }

function UploadModuleDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [raw, setRaw] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setRaw(''); setParseError(null); setPreview(null); setCommitResult(null); setError(null);
  }

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
        setParseError('The file must be a JSON object with a top-level "sets" array — one entry per module.');
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
    try { setPreview(await api<PreviewResult>('/admin/question-sets/import/preview', { method: 'POST', body })); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function runCommit() {
    const body = parsed();
    if (!body) return;
    setBusy(true); setError(null);
    try {
      setCommitResult(await api<CommitResult>('/admin/free-test-pool/modules', { method: 'POST', body }));
      setPreview(null);
      onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  const canCommit = preview !== null && preview.totalIssues === 0;

  return (
    <Dialog open={open} onClose={() => { reset(); onClose(); }} title="Upload module(s)">
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">
          Each set in the file becomes its own independent module, immediately eligible for free-test rotation.
          Listening/Reading sets become a published diagnostic test automatically — no separate re-typing step.
          Writing/Speaking sets publish directly.
        </p>
        <div>
          <label className="mb-1 block text-sm font-medium">JSON file</label>
          <input type="file" accept="application/json,.json" onChange={onFile} className="block w-full text-sm" />
        </div>
        {parseError && <Alert>{parseError}</Alert>}
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={runPreview} busy={busy} disabled={!raw.trim()}>Preview</Button>
          <Button onClick={runCommit} busy={busy} disabled={!canCommit} variant={canCommit ? 'primary' : 'secondary'}>
            Upload {preview ? `(${preview.totalQuestions} questions, ${preview.sets.length} module(s))` : ''}
          </Button>
        </div>

        {preview && (
          <div className="space-y-2">
            <div className="flex gap-4 text-sm">
              <span>{preview.sets.length} module(s)</span>
              <span>{preview.totalQuestions} question(s)</span>
              <span className={preview.totalIssues > 0 ? 'text-danger' : 'text-success'}>{preview.totalIssues} issue(s)</span>
            </div>
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {preview.sets.map((s) => (
                <li key={s.setIndex}>
                  {s.title} — {s.questionCount} question(s)
                  {s.issues.length > 0 && <span className="text-danger"> — {s.issues.length} issue(s)</span>}
                </li>
              ))}
            </ul>
            {!canCommit && preview.totalIssues > 0 && <Alert>Fix the flagged issues and re-upload before this can go live.</Alert>}
          </div>
        )}

        {commitResult && (
          <div className="space-y-2">
            <Alert kind="success">{commitResult.modules.length} module(s) are live in the free-test pool.</Alert>
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {commitResult.modules.map((m) => (
                <li key={m.moduleId}>
                  {m.title} ({m.skill.toLowerCase()}) — {m.questionCount} question(s)
                  {m.needsAudio && (
                    <>
                      {' '}— <Link href={`/admin/assessments/${m.moduleId}`} className="text-primary hover:underline">add audio</Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export default function FreeTestsAdminPage() {
  const qc = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const { data: pool, isLoading } = useQuery({ queryKey: ['free-test-pool'], queryFn: () => api<PoolStats>('/admin/free-test-pool') });
  const { data: modules, isLoading: modulesLoading } = useQuery({ queryKey: ['free-test-modules'], queryFn: () => api<ModuleRow[]>('/admin/free-test-pool/modules') });
  const { data: leads } = useQuery({ queryKey: ['free-test-leads'], queryFn: () => api<{ total: number; items: LeadRow[] }>('/admin/free-test-leads') });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['free-test-pool'] });
    qc.invalidateQueries({ queryKey: ['free-test-modules'] });
  }

  return (
    <>
      <PageHeader
        title="Free test modules"
        subtitle="Every Listening/Reading/Writing/Speaking module lives here, however many you upload. Each one is its own independent unit in the rotation — a free-test visitor gets one module per skill, picked from whichever has been used least."
        actions={<Button onClick={() => setUploadOpen(true)}>Upload module(s)</Button>}
      />

      <h2 className="mb-2 mt-6 font-semibold">Eligible pool, by skill</h2>
      {isLoading ? <Loading /> : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {([
            ['Listening', pool?.listening ?? 0],
            ['Reading', pool?.reading ?? 0],
            ['Writing', pool?.writing ?? 0],
            ['Speaking', pool?.speaking ?? 0],
          ] as const).map(([label, count]) => (
            <div key={label} className="rounded-lg border p-4">
              <div className="text-xs text-fg-muted">{label}</div>
              <div className="text-2xl font-semibold">{count}</div>
              {count === 0 && <div className="mt-1 text-xs text-red-600">Nothing eligible yet</div>}
            </div>
          ))}
        </div>
      )}

      <h2 className="mb-2 mt-8 font-semibold">Modules</h2>
      {modulesLoading ? <Loading /> : (
        <Table head={['Title', 'Skill', 'Published', 'Created']}>
          {(modules ?? []).map((m) => (
            <tr key={m.id}>
              <Td>{m.kind === 'ASSESSMENT' ? <Link href={`/admin/assessments/${m.id}`} className="text-primary hover:underline">{m.title}</Link> : m.title}</Td>
              <Td>{m.skill.toLowerCase()}</Td>
              <Td><Badge status={m.published ? 'PUBLISHED' : 'DRAFT'} tone={m.published ? 'green' : 'slate'} /></Td>
              <Td>{new Date(m.createdAt).toLocaleDateString()}</Td>
            </tr>
          ))}
        </Table>
      )}

      <h2 className="mb-2 mt-8 font-semibold">Recent leads</h2>
      <Table head={['Email', 'Phone', 'Status', 'Stage', 'Overall estimate', 'Linked to account', 'Claimed']}>
        {(leads?.items ?? []).map((l) => (
          <tr key={l.id}>
            <Td>{l.email}</Td>
            <Td>{l.phone}</Td>
            <Td><Badge status={l.status} /></Td>
            <Td>{l.stage ?? '—'}</Td>
            <Td>{l.overallEstimate != null ? l.overallEstimate : l.missingSkills.length ? `Partial (missing ${l.missingSkills.join(', ')})` : '—'}</Td>
            <Td>{l.linked ? 'Yes' : 'No'}</Td>
            <Td>{new Date(l.createdAt).toLocaleString()}</Td>
          </tr>
        ))}
      </Table>

      <UploadModuleDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onDone={refresh} />
    </>
  );
}
