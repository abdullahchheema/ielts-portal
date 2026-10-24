'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, PageHeader, Pagination, Section, Select, Table, Td, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface MockExam {
  id: string; title: string; status: string; libraryVisible: boolean; createdAt: string;
  listeningModuleTitle: string; readingModuleTitle: string; attemptsCount: number;
}
interface ModuleSummary { id: string; title: string; skill: string; module: string | null; usageCount: number; usedByMocks: { id: string; title: string }[] }
const TAKE = 25;

export default function MockExamsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [skip, setSkip] = useState(0);
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [title, setTitle] = useState('');
  const [listeningSetId, setListeningSetId] = useState('');
  const [readingSetId, setReadingSetId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-mock-exams', skip],
    queryFn: () => api<{ items: MockExam[]; total: number }>(`/admin/mock-exams?skip=${skip}&take=${TAKE}`),
  });

  const modules = useQuery({
    queryKey: ['admin-question-sets-published-summary'],
    queryFn: () => api<ModuleSummary[]>('/admin/question-sets/published-summary'),
    enabled: mode === 'manual',
  });

  const listeningModules = modules.data?.filter((m) => m.skill === 'LISTENING') ?? [];
  const readingModules = modules.data?.filter((m) => m.skill === 'READING') ?? [];

  async function compose() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const body: Record<string, unknown> = { title };
      if (mode === 'manual') { body.listeningSetId = listeningSetId; body.readingSetId = readingSetId; }
      await api('/admin/mock-exams/compose', { method: 'POST', body });
      setNotice('Mock test composed and published to the library.');
      setTitle(''); setListeningSetId(''); setReadingSetId('');
      await qc.invalidateQueries({ queryKey: ['admin-mock-exams'] });
      await qc.invalidateQueries({ queryKey: ['admin-question-sets-published-summary'] });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function toggle(m: MockExam) {
    setToggling(m.id); setError(null);
    try {
      await api(`/admin/mock-exams/${m.id}/library`, { method: 'POST', body: { visible: !m.libraryVisible } });
      await qc.invalidateQueries({ queryKey: ['admin-mock-exams'] });
    } catch (e) { setError(errorMessage(e)); } finally { setToggling(null); }
  }

  async function remove(m: MockExam) {
    const ok = await confirm({
      title: 'Delete mock test',
      message: m.attemptsCount > 0
        ? `"${m.title}" has ${m.attemptsCount} attempt${m.attemptsCount === 1 ? '' : 's'}. It will be archived and hidden from the library (student history is kept).`
        : `Delete "${m.title}" permanently? This cannot be undone.`,
      confirmLabel: m.attemptsCount > 0 ? 'Archive' : 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    setDeleting(m.id); setError(null);
    try {
      await api(`/admin/mock-exams/${m.id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['admin-mock-exams'] });
      await qc.invalidateQueries({ queryKey: ['admin-question-sets-published-summary'] });
    } catch (e) { setError(errorMessage(e)); } finally { setDeleting(null); }
  }

  const manualReady = mode === 'auto' || (listeningSetId && readingSetId);
  const composeDisabled = title.trim().length < 3 || !manualReady;

  return (
    <>
      <PageHeader title="Mock tests" subtitle="Each mock bundles a Listening and a Reading module. Choose auto-pick to rotate the least-used modules, or select manually." />
      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Section title="Compose a mock" className="mb-8">
        <Card className="max-w-lg space-y-4">
          <Field label="Title">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mock Test 7" />}</Field>

          <Field label="Module selection">
            {(p) => (
              <Select {...p} value={mode} onChange={(e) => { setMode(e.target.value as 'auto' | 'manual'); setListeningSetId(''); setReadingSetId(''); }}>
                <option value="auto">Auto-pick (least used rotation)</option>
                <option value="manual">Manual selection</option>
              </Select>
            )}
          </Field>

          {mode === 'manual' && (
            <>
              {modules.isLoading && <Loading />}
              {modules.isError && <Alert>Could not load modules.</Alert>}
              {!modules.isLoading && !modules.isError && (
                <>
                  <Field label="Listening module">
                    {(p) => (
                      <Select {...p} value={listeningSetId} onChange={(e) => setListeningSetId(e.target.value)}>
                        <option value="">— choose —</option>
                        {listeningModules.map((m) => (
                          <option key={m.id} value={m.id}>{m.title}{m.usageCount > 0 ? ` (used in ${m.usageCount} mock${m.usageCount === 1 ? '' : 's'})` : ''}</option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Reading module">
                    {(p) => (
                      <Select {...p} value={readingSetId} onChange={(e) => setReadingSetId(e.target.value)}>
                        <option value="">— choose —</option>
                        {readingModules.map((m) => (
                          <option key={m.id} value={m.id}>{m.title}{m.usageCount > 0 ? ` (used in ${m.usageCount} mock${m.usageCount === 1 ? '' : 's'})` : ''}</option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </>
              )}
            </>
          )}

          <div className="flex justify-end">
            <Button onClick={compose} busy={busy} disabled={composeDisabled}>Compose &amp; publish</Button>
          </div>
        </Card>
      </Section>

      <Section title="Mock tests">
        {isLoading && <Loading />}
        {isError && <Alert>Could not load mock tests.</Alert>}
        {data && (data.items.length === 0 ? <Empty title="No mock tests yet">Compose one above.</Empty> : (
          <>
            <Table head={['Title', 'Listening module', 'Reading module', 'Attempts', 'Status', 'In library', 'Composed', '']} sticky>
              {data.items.map((m) => (
                <tr key={m.id}>
                  <Td className="font-medium">{m.title}</Td>
                  <Td className="text-sm text-fg-muted">{m.listeningModuleTitle}</Td>
                  <Td className="text-sm text-fg-muted">{m.readingModuleTitle}</Td>
                  <Td className="tabular-nums">{m.attemptsCount}</Td>
                  <Td><Badge status={m.status} /></Td>
                  <Td>{m.libraryVisible ? 'Yes' : 'No'}</Td>
                  <Td>{date(m.createdAt)}</Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="xs" busy={toggling === m.id} onClick={() => toggle(m)}>{m.libraryVisible ? 'Hide' : 'Show'}</Button>
                      <Button variant="ghost" size="xs" tone="danger" busy={deleting === m.id} onClick={() => remove(m)}>Delete</Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
            <Pagination skip={skip} take={TAKE} total={data.total} onSkip={setSkip} />
          </>
        ))}
      </Section>
    </>
  );
}
