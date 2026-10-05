'use client';

import { Upload } from 'lucide-react';
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

/** File picker: a styled button, the chosen filename beside it, and a visible focus ring. The native input stays in the DOM for accessibility. */
export function FileInput({ file, placeholder = 'No file chosen', id, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> & { file?: File | null; placeholder?: string }) {
  const uid = useId();
  const inputId = id ?? uid;
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-md bg-surface px-2.5 py-2 shadow-xs ring-1 ring-inset ring-border-strong has-focus-visible:ring-2 has-focus-visible:ring-primary">
      <label htmlFor={inputId} className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-surface-muted px-3 py-1.5 text-sm font-medium text-fg ring-1 ring-inset ring-border-strong transition-colors hover:bg-border">
        <Upload aria-hidden className="size-4 text-fg-muted" strokeWidth={1.75} />
        Choose file
      </label>
      <span className={'min-w-0 truncate text-sm ' + (file ? 'text-fg' : 'text-fg-subtle')}>{file?.name ?? placeholder}</span>
      <input {...rest} id={inputId} type="file" className="sr-only" onChange={onChange} />
    </div>
  );
}
