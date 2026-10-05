'use client';

import { KeyboardEvent, useRef } from 'react';
import { cx } from '@/lib/cx';

export interface TabItem { key: string; label: string; count?: number }

/** Accessible tablist: arrow keys move focus, Home/End jump. `underline` suits dialogs; `segment` suits page-level switches. */
export function Tabs({ items, value, onChange, variant = 'segment', 'aria-label': ariaLabel }: {
  items: TabItem[]; value: string; onChange: (key: string) => void; variant?: 'segment' | 'underline'; 'aria-label': string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const k = items[next].key;
    onChange(k);
    refs.current[k]?.focus();
  }

  const isSeg = variant === 'segment';
  return (
    <div role="tablist" aria-label={ariaLabel} className={cx('flex flex-wrap gap-1', isSeg ? 'inline-flex rounded-lg bg-surface-muted p-1' : 'py-1.5')}>
      {items.map((t, i) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            ref={(el) => { refs.current[t.key] = el; }}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              'inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              isSeg
                ? cx('rounded-md px-3.5 py-1.5', active ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg')
                : cx('border-b-2 px-3 pb-2.5 pt-1.5 -mb-px', active ? 'border-primary text-primary' : 'border-transparent text-fg-muted hover:text-fg hover:border-border-strong'),
            )}
          >
            {t.label}
            {t.count !== undefined && <span className={cx('rounded-full px-1.5 text-xs tabular-nums', active ? 'bg-primary-soft text-primary' : 'bg-surface-muted text-fg-muted')}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
