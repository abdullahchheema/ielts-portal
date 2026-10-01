'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { date } from '@/lib/format';

interface Item { id: string; type: string; title: string; body: string | null; readAt: string | null; createdAt: string; entityType?: string | null; entityId?: string | null; link?: string | null }
interface Feed { unread: number; items: Item[] }

export function NotificationBell() {
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api<Feed>('/me/notifications'), refetchInterval: 60_000 });
  const readAll = useMutation({ mutationFn: () => api('/me/notifications/read', { method: 'POST', body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const readOne = useMutation({ mutationFn: (id: string) => api(`/me/notifications/${id}/read`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  function onItemClick(n: Item) {
    if (!n.readAt) readOne.mutate(n.id);
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  const unread = data?.unread ?? 0;
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-haspopup="true" aria-expanded={open} aria-label={unread ? 'Notifications, ' + unread + ' unread' : 'Notifications'} className="relative rounded-md p-2 text-slate-700 hover:bg-slate-100">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div role="region" aria-label="Notifications" className="absolute right-0 z-30 mt-2 w-80 max-w-[90vw] rounded-lg bg-white shadow-lg ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5"><span className="text-sm font-semibold">Notifications</span>{unread > 0 && <button className="text-xs text-indigo-700 underline" onClick={() => readAll.mutate()}>Mark all read</button>}</div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-auto">
            {!data?.items.length && <li className="px-4 py-6 text-center text-sm text-slate-500">Nothing yet.</li>}
            {data?.items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onItemClick(n)}
                  className={'block w-full px-4 py-3 text-left text-sm hover:bg-slate-50 ' + (n.readAt ? '' : 'bg-indigo-50/50')}
                >
                  <p className="font-medium text-slate-900">{n.title}</p>
                  {n.body && <p className="text-slate-600">{n.body}</p>}
                  <p className="mt-0.5 text-xs text-slate-400">{date(n.createdAt, true)}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
