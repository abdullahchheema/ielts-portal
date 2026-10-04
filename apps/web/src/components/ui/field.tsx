'use client';

import { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef, useId } from 'react';
import { cx } from '@/lib/cx';

const inputCls =
  'block w-full rounded-md border-0 bg-surface px-3 py-2 text-sm text-fg shadow-xs ring-1 ring-inset ring-border-strong ' +
  'placeholder:text-fg-subtle transition-shadow duration-150 ' +
  'focus:ring-2 focus:ring-primary focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-muted ' +
  'aria-[invalid=true]:ring-danger aria-[invalid=true]:focus:ring-danger';

export function Field({ label: text, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: (p: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode; htmlFor?: string }) {
  const uid = useId();
  const id = htmlFor ?? uid;
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-fg">{text}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && !error && <p id={`${id}-hint`} className="text-xs leading-relaxed text-fg-muted">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="text-xs font-medium text-danger">{error}</p>}
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
