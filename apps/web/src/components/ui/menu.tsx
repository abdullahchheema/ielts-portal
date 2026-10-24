'use client';

import { ReactNode, cloneElement, isValidElement, useEffect, useRef, useState } from 'react';
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

  // The trigger is itself a <button> in every caller; wrapping it in another <button> produced
  // invalid nested buttons and swallowed the toggle whenever the trigger's own onClick (e.g.
  // stopPropagation to block a parent row click) stopped the event before it reached here.
  // Cloning the toggle directly onto the trigger's onClick avoids the wrapper entirely.
  const triggerEl = isValidElement(trigger)
    ? cloneElement(trigger as React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>, {
        onClick: (e: React.MouseEvent) => {
          (trigger as React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>).props.onClick?.(e);
          setOpen((v) => !v);
        },
        'aria-haspopup': 'menu',
        'aria-expanded': open,
      } as Record<string, unknown>)
    : trigger;

  return (
    <div ref={ref} className="relative inline-block">
      {triggerEl}
      {open && (
        <div
          role="menu"
          className={cx(
            'absolute top-full z-30 mt-1.5 min-w-40 overflow-hidden rounded-xl border border-border bg-surface py-1.5 shadow-lg',
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
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-[var(--dur-fast)] ease-out-soft',
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
