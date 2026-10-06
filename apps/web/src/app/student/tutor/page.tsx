'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Empty, Loading, PageHeader, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface Conv { id: string; title: string; mode: string; updatedAt: string }
interface Msg { id: string; role: 'USER' | 'ASSISTANT'; content: string; sources: string[] | null }

const MODES = ['GENERAL', 'READING', 'WRITING', 'SPEAKING', 'GRAMMAR', 'VOCABULARY'] as const;

/** AI tutor. Answers come from approved academy material. Your chats are private to you. */
export default function TutorPage() {
  const qc = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const [mode, setMode] = useState<(typeof MODES)[number]>('GENERAL');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const convs = useQuery({ queryKey: ['tutor-convs'], queryFn: () => api<Conv[]>('/me/tutor/conversations') });
  const msgs = useQuery({ queryKey: ['tutor-msgs', active], queryFn: () => api<Msg[]>(`/me/tutor/conversations/${active}`), enabled: !!active });
  const refresh = () => qc.invalidateQueries({ queryKey: ['tutor-convs'] });

  async function newChat() {
    setError(null);
    try {
      const c = await api<Conv>('/me/tutor/conversations', { method: 'POST', body: { mode } });
      setActive(c.id);
      await refresh();
    } catch (e) { setError(errorMessage(e)); }
  }

  async function send() {
    if (!active || draft.trim().length === 0) return;
    setBusy(true); setError(null);
    const text = draft.trim();
    setDraft('');
    try {
      await api(`/me/tutor/conversations/${active}/messages`, { method: 'POST', body: { content: text } });
      await Promise.all([qc.invalidateQueries({ queryKey: ['tutor-msgs', active] }), refresh()]);
    } catch (e) {
      setError(errorMessage(e));
      setDraft(text);
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this conversation?')) return;
    try {
      await api(`/me/tutor/conversations/${id}`, { method: 'DELETE' });
      if (active === id) setActive(null);
      await refresh();
    } catch (e) { setError(errorMessage(e)); }
  }

  return (
    <>
      <PageHeader title="AI tutor" subtitle="Ask about IELTS. Answers come from academy material, and this is practice support, not an official result." />
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <Card className="space-y-3">
          <div className="flex gap-2">
            <Select aria-label="Topic" value={mode} onChange={(e) => setMode(e.target.value as (typeof MODES)[number])}>
              {MODES.map((m) => <option key={m} value={m}>{m[0] + m.slice(1).toLowerCase()}</option>)}
            </Select>
            <Button onClick={newChat}>New chat</Button>
          </div>
          {convs.isLoading && <Loading />}
          {convs.data && convs.data.length === 0 && <p className="text-sm text-fg-muted">No chats yet.</p>}
          <ul className="space-y-1">
            {convs.data?.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <button onClick={() => setActive(c.id)} className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm ${active === c.id ? 'bg-primary-soft text-fg' : 'text-fg-muted hover:bg-surface-muted'}`}>{c.title}</button>
                <button onClick={() => remove(c.id)} aria-label="Delete chat" className="px-1 text-xs text-fg-subtle hover:text-danger">×</button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex min-h-[28rem] flex-col gap-4">
          {!active ? <Empty title="Start a chat">Pick a topic and start a new chat.</Empty> : (
            <>
              <div className="flex-1 space-y-3 overflow-y-auto">
                {msgs.isLoading && <Loading />}
                {msgs.data?.map((m) => (
                  <div key={m.id} className={m.role === 'USER' ? 'text-right' : ''}>
                    <p className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${m.role === 'USER' ? 'bg-primary text-white' : 'bg-surface-muted text-fg'}`}>{m.content}</p>
                    {m.role === 'ASSISTANT' && m.sources && m.sources.length > 0 && <p className="mt-1 text-xs text-fg-subtle">Sources: {m.sources.join(', ')}</p>}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Textarea aria-label="Your question" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask a question…" />
                <Button onClick={send} busy={busy} disabled={draft.trim().length === 0}>Send</Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
