'use client';

import { SkeletonTable } from '@/components/ui';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Empty, Field, Loading, PageHeader, Section, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { date, label } from '@/lib/format';

interface Ticket {
  id: string; subject: string; description: string; category: string; priority: string; status: string; assignedTo: string | null; createdAt: string;
  messages: { id: string; authorId: string; body: string; internal: boolean; createdAt: string }[];
  user: { email: string; student: { firstName: string; lastName: string; enrollments: { status: string; course: { title: string }; batch: { name: string } }[] } | null };
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: t, isLoading, isError } = useQuery({ queryKey: ['admin-ticket', id], queryFn: () => api<Ticket>('/admin/tickets/' + id) });
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-ticket', id] }); qc.invalidateQueries({ queryKey: ['admin-tickets'] }); };
  if (isLoading) return <SkeletonTable rows={6} cols={5} />;
  if (isError || !t) return <Alert>Ticket not found.</Alert>;

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); refresh(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  const name = t.user.student ? t.user.student.firstName + ' ' + t.user.student.lastName : t.user.email;

  return (
    <>
      <PageHeader title={t.subject} subtitle={name + ' · ' + t.user.email + ' · ' + label(t.category) + ' · ' + date(t.createdAt, true)} actions={<Badge status={t.status} />} />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-6">
          <Section title="Conversation">
            <div className="space-y-3">
              <Card><p className="mb-1 text-xs text-fg-muted">Original request</p><p className="whitespace-pre-wrap text-sm">{t.description}</p></Card>
              {t.messages.map((m) => (
                <Card key={m.id} className={m.internal ? 'bg-amber-50 ring-amber-200' : ''}>
                  <p className="mb-1 text-xs text-fg-muted">{date(m.createdAt, true)}{m.internal && ' · internal note (not visible to the student)'}</p>
                  <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                </Card>
              ))}
              <Card className="space-y-3">
                <Textarea aria-label="Reply" rows={4} placeholder="Write a reply…" value={body} onChange={(e) => setBody(e.target.value)} />
                <Checkbox label="Internal note (only staff can see it)" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                <Button busy={busy} disabled={!body.trim()} onClick={() => run(async () => { await api('/admin/tickets/' + id + '/messages', { method: 'POST', body: { body, internal } }); setBody(''); })}>{internal ? 'Add note' : 'Send reply'}</Button>
              </Card>
            </div>
          </Section>
        </div>
        <div className="space-y-6">
          <Section title="Ticket details">
            <Card className="space-y-3">
              <Field label="Status">{(p) => <Select {...p} value={t.status} onChange={(e) => run(() => api('/admin/tickets/' + id, { method: 'PATCH', body: { status: e.target.value } }))}>{['OPEN', 'IN_PROGRESS', 'WAITING_FOR_STUDENT', 'RESOLVED', 'CLOSED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>}</Field>
              <Field label="Priority">{(p) => <Select {...p} value={t.priority} onChange={(e) => run(() => api('/admin/tickets/' + id, { method: 'PATCH', body: { priority: e.target.value } }))}>{['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>}</Field>
              {me && <Button variant="secondary" className="w-full" disabled={t.assignedTo === me.id} onClick={() => run(() => api('/admin/tickets/' + id, { method: 'PATCH', body: { assignedTo: me.id, status: t.status === 'OPEN' ? 'IN_PROGRESS' : undefined } }))}>{t.assignedTo === me.id ? 'Assigned to you' : 'Assign to me'}</Button>}
            </Card>
          </Section>
          <Section title="Enrollments">
            {t.user.student?.enrollments.length ? (
              <ul className="space-y-2 text-sm">
                {t.user.student.enrollments.map((e, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 rounded-md bg-canvas px-3 py-2">
                    <span>{e.course.title}<span className="block text-xs text-fg-muted">{e.batch.name}</span></span>
                    <Badge status={e.status} />
                  </li>
                ))}
              </ul>
            ) : <Empty>No enrollments for this student.</Empty>}
          </Section>
        </div>
      </div>
    </>
  );
}
