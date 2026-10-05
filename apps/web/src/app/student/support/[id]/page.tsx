'use client';

import { SkeletonTable } from '@/components/ui';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Loading, PageHeader, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date, label } from '@/lib/format';

interface Ticket { id: string; subject: string; description: string; category: string; status: string; createdAt: string; messages: { id: string; authorId: string; body: string; createdAt: string }[] }

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: t, isLoading, isError } = useQuery({ queryKey: ['ticket', id], queryFn: () => api<Ticket>(`/me/tickets/${id}`) });
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (isLoading) return <SkeletonTable rows={6} cols={5} />;
  if (isError || !t) return <Alert>Ticket not found.</Alert>;

  async function send() {
    setBusy(true); setError(null);
    try { await api(`/me/tickets/${id}/messages`, { method: 'POST', body: { body } }); setBody(''); await qc.invalidateQueries({ queryKey: ['ticket', id] }); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title={t.subject} subtitle={`${label(t.category)} · opened ${date(t.createdAt, true)}`} actions={<Badge status={t.status} />} />
      <div className="max-w-2xl space-y-3">
        <Card><p className="mb-1 text-xs text-fg-muted">You wrote</p><p className="whitespace-pre-wrap text-sm">{t.description}</p></Card>
        {t.messages.map((m) => (
          <Card key={m.id} className={m.authorId === undefined ? '' : 'bg-primary-soft/40'}><p className="mb-1 text-xs text-fg-muted">{date(m.createdAt, true)}</p><p className="whitespace-pre-wrap text-sm">{m.body}</p></Card>
        ))}
        {t.status !== 'CLOSED' ? (
          <Card className="space-y-3">
            {error && <Alert>{error}</Alert>}
            <Textarea aria-label="Reply" rows={4} placeholder="Write a reply…" value={body} onChange={(e) => setBody(e.target.value)} />
            <Button onClick={send} busy={busy} disabled={!body.trim()}>Send reply</Button>
          </Card>
        ) : <Alert kind="info">This request is closed. Open a new one if you need more help.</Alert>}
      </div>
    </>
  );
}
