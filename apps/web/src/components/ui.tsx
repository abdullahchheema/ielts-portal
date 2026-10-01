'use client';

import Link from 'next/link';
import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef, useId } from 'react';
import { label } from '@/lib/format';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

// ───────── buttons ─────────
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:outline-indigo-600',
  secondary: 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 focus-visible:outline-indigo-600',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600',
  ghost: 'text-slate-700 hover:bg-slate-100 focus-visible:outline-indigo-600',
};

export function Button({ variant = 'primary', busy, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx('inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60', VARIANTS[variant], className)}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = 'primary', children, className }: { href: string; variant?: Variant; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cx('inline-flex items-center justify-center rounded-md px-3.5 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2', VARIANTS[variant], className)}>
      {children}
    </Link>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <span role="status" aria-label="Loading" className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', small ? 'h-4 w-4' : 'h-6 w-6')} />;
}

// ───────── form fields ─────────
const inputCls = 'block w-full rounded-md border-0 px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-600 disabled:bg-slate-50 aria-[invalid=true]:ring-red-500';

export function Field({ label: text, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: (p: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode; htmlFor?: string }) {
  const uid = useId();
  const id = htmlFor ?? uid;
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">{text}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} {...p} className={cx(inputCls, className)} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} {...p} className={cx(inputCls, className)} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} {...p} className={cx(inputCls, className)} />;
});

// ───────── layout bits ─────────
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200', className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info' | 'warning'; children: ReactNode }) {
  const styles = { error: 'bg-red-50 text-red-800 ring-red-200', success: 'bg-green-50 text-green-800 ring-green-200', info: 'bg-blue-50 text-blue-800 ring-blue-200', warning: 'bg-amber-50 text-amber-900 ring-amber-200' };
  return <div role={kind === 'error' ? 'alert' : 'status'} className={cx('rounded-md px-4 py-3 text-sm ring-1', styles[kind])}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{children}</div>;
}

export function Loading() {
  return <div className="flex justify-center p-10 text-slate-500"><Spinner /></div>;
}

export function ProgressBar({ value, label: text }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div>
      {text && <div className="mb-1 flex justify-between text-xs text-slate-600"><span>{text}</span><span>{Math.round(v)}%</span></div>}
      <div role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={text ?? 'Progress'} className="h-2 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

const TONE: Record<string, string> = {
  ACTIVE: 'green', PAID: 'green', APPROVED: 'green', OPEN: 'green', COMPLETED: 'blue', PUBLISHED: 'green', CONFIRMED: 'green',
  PENDING_REVIEW: 'amber', SUBMITTED: 'amber', AWAITING_PAYMENT: 'amber', UNDER_REVIEW: 'amber', HELD: 'amber', DRAFT: 'slate', PENDING: 'amber',
  PENDING_PAYMENT: 'amber', IN_PROGRESS: 'blue', PAUSED: 'amber', PENDING_VERIFICATION: 'amber',
  REJECTED: 'red', CANCELLED: 'red', EXPIRED: 'red', SUSPENDED: 'red', BLOCKED: 'red', REFUNDED: 'red', LOCKED: 'slate', RETIRED: 'slate', ARCHIVED: 'slate',
};
const TONE_CLS: Record<string, string> = {
  green: 'bg-green-50 text-green-700 ring-green-600/20', amber: 'bg-amber-50 text-amber-800 ring-amber-600/20', red: 'bg-red-50 text-red-700 ring-red-600/20',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/20', purple: 'bg-purple-50 text-purple-700 ring-purple-600/20', slate: 'bg-slate-100 text-slate-700 ring-slate-500/20',
};

export function Badge({ status, tone, text }: { status: string; tone?: keyof typeof TONE_CLS; text?: string }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONE_CLS[tone ?? TONE[status] ?? 'slate'])}>{text ?? label(status)}</span>;
}

// ───────── table ─────────
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
      <table className="min-w-full divide-y divide-slate-200 bg-white text-sm">
        <thead className="bg-slate-50">
          <tr>{head.map((h) => <th key={h} scope="col" className="whitespace-nowrap px-4 py-3 text-left font-medium text-slate-600">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cx('px-4 py-3 align-top text-slate-800', className)}>{children}</td>;

// ───────── dialog (native <dialog> = focus trap + Esc for free) ─────────
import { useEffect, useRef } from 'react';
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dlg-title" className="w-full max-w-lg rounded-lg p-0 shadow-xl backdrop:bg-slate-900/50">
      <div className="p-6">
        <h2 id="dlg-title" className="mb-4 text-lg font-semibold text-slate-900">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

// ───────── detail dialog: wider, scrollable, sticky header, optional tabs ─────────
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
    <dialog ref={ref} onClose={onClose} aria-labelledby="detail-dlg-title" className="w-full max-w-4xl rounded-lg p-0 shadow-xl backdrop:bg-slate-900/50">
      <div className="flex max-h-[85vh] flex-col">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-6 py-4">
          <div className="min-w-0">
            <h2 id="detail-dlg-title" className="truncate text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-sm text-slate-500">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        {tabs && tabs.length > 0 && (
          <div role="tablist" aria-label="Sections" className="flex flex-wrap gap-1 border-b border-slate-100 bg-slate-50 px-4 py-2">
            {tabs.map((t) => (
              <button key={t.key} role="tab" type="button" aria-selected={activeTab === t.key} onClick={() => onTabChange?.(t.key)}
                className={cx('rounded-md px-3 py-1.5 text-sm font-medium', activeTab === t.key ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-white')}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </dialog>
  );
}

// ───────── label/value grid ─────────
export function DefinitionList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={i}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{it.label}</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-6 last:mb-0', className)}>
      {title && <h3 className="mb-2.5 text-sm font-semibold text-slate-900">{title}</h3>}
      {children}
    </div>
  );
}

// ───────── clickable table row ─────────
export function ClickableRow({ onClick, children, className }: { onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <tr
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      role="button"
      tabIndex={0}
      className={cx('cursor-pointer hover:bg-slate-50', className)}
    >
      {children}
    </tr>
  );
}
