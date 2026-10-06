'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '@/lib/cx';

/**
 * Side panel for detail views that should not navigate away (notes, follow-ups, a student's quick view).
 * Closes on Escape and on backdrop click; focus stays inside while open.
 */
export function Drawer({ open, onClose, title, children, width = 'md' }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; width?: 'md' | 'lg';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-overlay" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label={title} className={cx('relative flex h-full w-full flex-col border-l border-border bg-surface shadow-xl', width === 'lg' ? 'max-w-2xl' : 'max-w-md')}>
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-semibold text-fg">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-fg-muted hover:bg-surface-muted">
            <X className="size-5" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}
