'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { cx } from '@/lib/cx';

export interface MenuItemDef { key: string; label: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean }

/** Trigger + dropdown panel. Closes on outside click, Escape, or selection. */
export function DropdownMenu({ trigger, items, align = 'end' }: { trigger: ReactNode; items: MenuItemDef[]; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={cx(
            'absolute top-full z-30 mt-1.5 min-w-40 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onSelect(); }}
              className={cx(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-100',
                it.danger ? 'text-danger hover:bg-danger-soft' : 'text-fg hover:bg-surface-muted',
                it.disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
              )}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
