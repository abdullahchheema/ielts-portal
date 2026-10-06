'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

export interface CommandItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  href: string;
}

/** Ctrl/Cmd+K opens the palette from anywhere in a portal. */
export function useCommandShortcut(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onOpen(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen]);
}

/**
 * Keyboard-first command palette. The caller supplies items (for global search, the results of
 * GET /search); this component only filters, moves the highlight, and navigates.
 */
export function CommandPalette({ open, onClose, items, query, onQuery, loading }: {
  open: boolean; onClose: () => void; items: CommandItem[]; query: string; onQuery: (q: string) => void; loading?: boolean;
}) {
  const router = useRouter();
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const grouped = useMemo(() => items, [items]);

  useEffect(() => { if (open) { setActive(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  useEffect(() => { setActive(0); }, [items]);

  if (!open) return null;

  function choose(item: CommandItem | undefined) {
    if (!item) return;
    onClose();
    router.push(item.href);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, grouped.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') choose(grouped[active]);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-overlay p-4 pt-[12vh]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="size-4 text-fg-subtle" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={onKey}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={grouped[active] ? `${listId}-${grouped[active].id}` : undefined}
            placeholder="Search students, batches, payments…"
            className="h-12 w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>
        <ul id={listId} role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {loading && <li className="px-3 py-2 text-sm text-fg-muted">Searching…</li>}
          {!loading && query.trim().length >= 2 && grouped.length === 0 && <li className="px-3 py-2 text-sm text-fg-muted">No matches.</li>}
          {!loading && query.trim().length < 2 && <li className="px-3 py-2 text-sm text-fg-muted">Type at least two characters.</li>}
          {grouped.map((item, i) => (
            <li
              key={item.id}
              id={`${listId}-${item.id}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(item)}
              className={`flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm ${i === active ? 'bg-primary-soft text-fg' : 'text-fg'}`}
            >
              <span className="truncate">{item.label}</span>
              <span className="ml-3 shrink-0 text-xs text-fg-subtle">{item.group}{item.hint ? ` · ${item.hint}` : ''}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
