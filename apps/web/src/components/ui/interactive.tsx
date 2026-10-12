'use client';

import { ChevronDown } from 'lucide-react';
import { InputHTMLAttributes, ReactNode, forwardRef, useId, useState } from 'react';
import { cx } from '@/lib/cx';

/** A thin rule, for separating sections without a full card boundary. */
export function Separator({ className, label }: { className?: string; label?: string }) {
  if (!label) return <hr className={cx('border-border', className)} />;
  return (
    <div className={cx('flex items-center gap-3', className)} role="separator">
      <hr className="flex-1 border-border" />
      <span className="text-xs font-medium tracking-wide text-fg-subtle uppercase">{label}</span>
      <hr className="flex-1 border-border" />
    </div>
  );
}

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }>(
  function Checkbox({ label, id, className, ...p }, ref) {
    const uid = useId();
    const inputId = id ?? uid;
    return (
      <label htmlFor={inputId} className={cx('inline-flex cursor-pointer items-center gap-2 text-sm text-fg', className)}>
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          {...p}
          className="size-4 rounded-sm border-0 bg-surface text-primary ring-1 ring-inset ring-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring checked:ring-primary"
        />
        {label}
      </label>
    );
  },
);

export const Radio = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }>(
  function Radio({ label, id, className, ...p }, ref) {
    const uid = useId();
    const inputId = id ?? uid;
    return (
      <label htmlFor={inputId} className={cx('inline-flex cursor-pointer items-center gap-2 text-sm text-fg', className)}>
        <input
          ref={ref}
          id={inputId}
          type="radio"
          {...p}
          className="size-4 rounded-full border-0 bg-surface text-primary ring-1 ring-inset ring-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring checked:ring-primary"
        />
        {label}
      </label>
    );
  },
);

/** Selectable answer card: the pattern the survey wizard uses for single/multi-select questions (bigger hit target than a bare radio). */
export function OptionCard({ selected, onClick, children, multi }: { selected: boolean; onClick: () => void; children: ReactNode; multi?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={selected}
      className={cx(
        'flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors duration-150 ease-out-soft',
        selected ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-fg hover:bg-surface-muted',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'grid size-4.5 shrink-0 place-items-center ring-1 ring-inset transition-colors',
          multi ? 'rounded-sm' : 'rounded-full',
          selected ? 'bg-primary ring-primary' : 'bg-surface ring-border-strong',
        )}
      >
        {selected && <span className={cx('bg-primary-fg', multi ? 'size-2 rounded-[1px]' : 'size-1.5 rounded-full')} />}
      </span>
      {children}
    </button>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; id?: string }) {
  const uid = useId();
  const inputId = id ?? uid;
  return (
    <label htmlFor={inputId} className="inline-flex cursor-pointer items-center gap-2.5">
      <button
        type="button"
        id={inputId}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-5.5 w-9.5 shrink-0 rounded-full transition-colors duration-150 ease-out-soft', checked ? 'bg-primary' : 'bg-border-strong')}
      >
        <span aria-hidden className={cx('absolute top-0.5 size-4.5 rounded-full bg-white shadow-xs transition-[left] duration-150 ease-out-soft', checked ? 'left-4.5' : 'left-0.5')} />
      </button>
      {label && <span className="text-sm text-fg">{label}</span>}
    </label>
  );
}

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      {children}
      {open && (
        <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-xs font-medium whitespace-nowrap text-ink-fg shadow-md">
          {content}
        </span>
      )}
    </span>
  );
}

export interface AccordionItem { key: string; title: ReactNode; content: ReactNode }

/** Single-open accordion. Shared by FAQ sections and progressive-disclosure settings panels. */
export function Accordion({ items, defaultOpen }: { items: AccordionItem[]; defaultOpen?: string }) {
  const [open, setOpen] = useState<string | null>(defaultOpen ?? null);
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-surface">
      {items.map((it) => {
        const isOpen = open === it.key;
        return (
          <div key={it.key}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : it.key)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-fg"
            >
              {it.title}
              <ChevronDown aria-hidden className={cx('size-4 shrink-0 text-fg-muted transition-transform duration-150 ease-out-soft', isOpen && 'rotate-180')} />
            </button>
            {isOpen && <div className="px-4 pb-4 text-sm leading-relaxed text-fg-muted">{it.content}</div>}
          </div>
        );
      })}
    </div>
  );
}
