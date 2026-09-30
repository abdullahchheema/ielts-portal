'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface Pref { type: string; label: string; inApp: boolean; email: boolean }

/** Users control non-essential notifications per channel. Payments, enrollment and grading messages are always sent. */
export function NotificationPrefs() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['notif-prefs'], queryFn: () => api<Pref[]>('/me/notifications/preferences') });
  const [local, setLocal] = useState<Record<string, Pref>>({});
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (isLoading || !data) return <Loading />;
  const rows = data.map((p) => local[p.type] ?? p);
  const set = (type: string, key: 'inApp' | 'email', v: boolean) => setLocal({ ...local, [type]: { ...(local[type] ?? data.find((p) => p.type === type)!), [key]: v } });

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await api('/me/notifications/preferences', { method: 'POST', body: { preferences: rows.map((r) => ({ type: r.type, inApp: r.inApp, email: r.email })) } });
      await qc.invalidateQueries({ queryKey: ['notif-prefs'] }); setLocal({}); setMsg({ kind: 'success', text: 'Preferences saved.' });
    } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }); } finally { setBusy(false); }
  }

  return (
    <Card className="max-w-xl space-y-3">
      <h2 className="font-semibold">Notifications</h2>
      <p className="text-sm text-slate-600">Choose how we remind you. Payment, enrollment and grading messages are always sent.</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500"><th className="py-1 font-medium">Reminder</th><th className="w-20 text-center font-medium">In app</th><th className="w-20 text-center font-medium">Email</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.type} className="border-t border-slate-100">
            <td className="py-2">{r.label}</td>
            <td className="text-center"><input type="checkbox" aria-label={r.label + ' in app'} checked={r.inApp} onChange={(e) => set(r.type, 'inApp', e.target.checked)} /></td>
            <td className="text-center"><input type="checkbox" aria-label={r.label + ' by email'} checked={r.email} onChange={(e) => set(r.type, 'email', e.target.checked)} /></td>
          </tr>
        ))}</tbody>
      </table>
      <Button onClick={save} busy={busy} disabled={Object.keys(local).length === 0}>Save preferences</Button>
    </Card>
  );
}
