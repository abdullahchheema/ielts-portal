'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { cx } from '@/lib/cx';

/** Short confirmations for actions that finish off-screen. Errors that belong to a form stay as inline Alerts. */
type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: ToastKind; text: string }

interface ToastApi {
  success(text: string): void;
  error(text: string): void;
  info(text: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);
const DISMISS_MS = 4000;
const ICON = { success: CheckCircle2, error: XCircle, info: Info } as const;
const TONE = {
  success: 'border-success/30 bg-success-soft text-success',
  error: 'border-danger/30 bg-danger-soft text-danger',
  info: 'border-info/30 bg-info-soft text-info',
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = nextId.current++;
    setItems((cur) => [...cur.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), DISMISS_MS);
  }, []);

  const api = useMemo<ToastApi>(() => ({
    success: (t) => push('success', t),
    error: (t) => push('error', t),
    info: (t) => push('info', t),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(92vw,22rem)] flex-col gap-2">
        {items.map((t) => {
          const Icon = ICON[t.kind];
          return (
            <div key={t.id} role="status" className={cx('pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-md', TONE[t.kind])}>
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t.text}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
