'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative grid size-9 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Bell aria-hidden className="size-4.5" strokeWidth={1.75} />
        {unread > 0 && <span aria-hidden className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold tabular-nums text-white ring-2 ring-surface">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div role="region" aria-label="Notifications" className="absolute right-0 z-40 mt-2 w-[22rem] max-w-[90vw] overflow-hidden rounded-lg bg-surface shadow-lg ring-1 ring-border">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="font-display text-sm font-semibold text-fg">Notifications</span>
            {unread > 0 && (
              <button type="button" className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => readAll.mutate()}>
                <CheckCheck aria-hidden className="size-3.5" />Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-border overflow-auto">
            {!data?.items.length && <li className="px-4 py-8 text-center text-sm text-fg-muted">You are all caught up.</li>}
            {data?.items.map((n) => {
              const isUnread = !n.readAt;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onItemClick(n)}
                    className={`flex w-full gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${isUnread ? 'bg-primary-soft/50' : ''}`}
                  >
                    <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${isUnread ? 'bg-primary' : 'bg-transparent'}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`block ${isUnread ? 'font-semibold text-fg' : 'font-medium text-fg-muted'}`}>{n.title}</span>
                      {n.body && <span className="mt-0.5 block text-fg-muted">{n.body}</span>}
                      <span className="mt-1 block text-xs text-fg-subtle tabular-nums">{date(n.createdAt, true)}{isUnread ? '' : ' · read'}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
