'use client';

import { X } from 'lucide-react';
import { ReactNode, useEffect, useRef } from 'react';
import { cx } from '@/lib/cx';
import { Tabs } from './tabs';

// Native <dialog> gives focus trap and Esc. Centring comes from the base layer in globals.css.
// Width is set in calc() rather than w-full, which fights the UA max-width on dialog:modal.
const SHELL = 'w-[calc(100%-2rem)] rounded-lg bg-surface p-0 text-fg shadow-xl ring-1 ring-border backdrop:bg-overlay';

export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dlg-title" className={cx(SHELL, 'max-w-lg')}>
      <div className="p-6">
        <h2 id="dlg-title" className="mb-4 font-display text-lg font-semibold text-fg">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

export interface TabDef { key: string; label: string }

export function DetailDialog({
  open, onClose, title, subtitle, tabs, activeTab, onTabChange, actions, children,
}: {
  open: boolean; onClose: () => void; title: string; subtitle?: string;
  tabs?: TabDef[]; activeTab?: string; onTabChange?: (key: string) => void;
  actions?: ReactNode; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="detail-dlg-title" className={cx(SHELL, 'max-w-4xl')}>
      <div className="flex max-h-[85vh] flex-col">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-surface px-6 py-4">
          <div className="min-w-0">
            <h2 id="detail-dlg-title" className="truncate font-display text-lg font-semibold text-fg">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-sm text-fg-muted">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring">
              <X aria-hidden className="size-4.5" />
            </button>
          </div>
        </div>
        {tabs && tabs.length > 0 && (
          <div className="border-b border-border bg-surface-muted/60 px-4">
            <Tabs
              aria-label="Sections"
              items={tabs.map((t) => ({ key: t.key, label: t.label }))}
              value={activeTab ?? tabs[0].key}
              onChange={(k) => onTabChange?.(k)}
              variant="underline"
            />
          </div>
        )}
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </dialog>
  );
}
