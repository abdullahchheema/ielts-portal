'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, PageHeader, Pagination, Section, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface MockExam { id: string; title: string; status: string; libraryVisible: boolean; createdAt: string }
const TAKE = 25;

/**
 * Composes whole-module mock tests: one click picks the least-used published Listening module and
 * the least-used published Reading module, builds/reuses their wrapper assessments, and publishes
 * the result as a library-visible mock — no manual count/difficulty/topic form, and no separate
 * publish/library steps.
 */
export default function MockExamsPage() {
  const qc = useQueryClient();
  const [skip, setSkip] = useState(0);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-mock-exams', skip],
    queryFn: () => api<{ items: MockExam[]; total: number }>(`/admin/mock-exams?skip=${skip}&take=${TAKE}`),
  });
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  async function compose() {
    setBusy(true); setError(null); setNotice(null);
    try {
      await api('/admin/mock-exams/compose', { method: 'POST', body: { title } });
      setNotice('Mock test composed and published to the library.');
      setTitle('');
      await qc.invalidateQueries({ queryKey: ['admin-mock-exams'] });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function toggle(m: MockExam) {
    setToggling(m.id); setError(null);
    try {
      await api(`/admin/mock-exams/${m.id}/library`, { method: 'POST', body: { visible: !m.libraryVisible } });
      await qc.invalidateQueries({ queryKey: ['admin-mock-exams'] });
    } catch (e) { setError(errorMessage(e)); } finally { setToggling(null); }
  }

  return (
    <>
      <PageHeader title="Mock tests" subtitle="Each mock bundles a Listening and a Reading module, automatically picked from whichever published modules have been used least." />
      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Section title="Compose a mock" className="mb-8">
        <Card className="max-w-lg space-y-4">
          <Field label="Title">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mock Test 7" />}</Field>
          <div className="flex justify-end">
            <Button onClick={compose} busy={busy} disabled={title.trim().length < 3}>Compose &amp; publish</Button>
          </div>
        </Card>
      </Section>

      <Section title="Mock tests">
        {isLoading && <Loading />}
        {isError && <Alert>Could not load mock tests.</Alert>}
        {data && (data.items.length === 0 ? <Empty title="No mock tests yet">Compose one above.</Empty> : (
          <>
            <Table head={['Title', 'Status', 'In library', 'Composed', '']} sticky>
              {data.items.map((m) => (
                <tr key={m.id}>
                  <Td className="font-medium">{m.title}</Td>
                  <Td><Badge status={m.status} /></Td>
                  <Td>{m.libraryVisible ? 'Yes' : 'No'}</Td>
                  <Td>{date(m.createdAt)}</Td>
                  <Td><Button variant="ghost" size="xs" busy={toggling === m.id} onClick={() => toggle(m)}>{m.libraryVisible ? 'Hide from library' : 'Show in library'}</Button></Td>
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
