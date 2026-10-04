'use client';

import { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Button } from './button';

export interface ConfirmOptions { title?: string; message: string; confirmLabel?: string; tone?: 'default' | 'danger' }
type Ask = (o: string | ConfirmOptions) => Promise<boolean>;
type Pending = { o: ConfirmOptions; resolve: (ok: boolean) => void };

const ConfirmContext = createContext<Ask | null>(null);

/** Mount once (see Providers). Lets any client component ask for a styled confirmation. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const current = useRef<Pending | null>(null);

  const ask = useCallback<Ask>((o) => new Promise<boolean>((resolve) => {
    const next = { o: typeof o === 'string' ? { message: o } : o, resolve };
    current.current = next;
    setPending(next);
  }), []);

  // Resolves exactly once: whichever of Cancel, Confirm or Esc happens first wins.
  const settle = useCallback((ok: boolean) => {
    const p = current.current;
    if (!p) return;
    current.current = null;
    setPending(null);
    p.resolve(ok);
  }, []);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <ConfirmDialog pending={pending} onSettle={settle} />
    </ConfirmContext.Provider>
  );
}

/**
 * Returns `ask(message | options) => Promise<boolean>`.
 * Usage: `onClick={() => confirm('Delete?').then((ok) => ok && remove())}`
 */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ask;
}

function ConfirmDialog({ pending, onSettle }: { pending: Pending | null; onSettle: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const open = pending !== null;
  const danger = pending?.o.tone === 'danger';

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); cancelRef.current?.focus(); }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={() => onSettle(false)}
      aria-labelledby="confirm-title"
      aria-describedby="confirm-body"
      className="w-[calc(100%-2rem)] max-w-md rounded-lg bg-surface p-0 text-fg shadow-xl ring-1 ring-border backdrop:bg-overlay"
    >
      <div className="p-6">
        <h2 id="confirm-title" className="font-display text-lg font-semibold text-fg">{pending?.o.title ?? (danger ? 'Please confirm' : 'Confirm action')}</h2>
        <p id="confirm-body" className="mt-2 whitespace-pre-line text-sm leading-relaxed text-fg-muted">{pending?.o.message}</p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} variant="secondary" onClick={() => onSettle(false)}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => onSettle(true)}>{pending?.o.confirmLabel ?? (danger ? 'Delete' : 'Confirm')}</Button>
        </div>
      </div>
    </dialog>
  );
}
