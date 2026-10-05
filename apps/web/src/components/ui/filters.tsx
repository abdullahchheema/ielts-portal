'use client';

import { Search } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './button';
import { Input } from './field';

/** Text search that waits for a pause in typing before it reports, so each keystroke is not a request. */
export function SearchInput({ value, onDebounced, label, placeholder = 'Search', delay = 300 }: {
  value: string; onDebounced: (v: string) => void; label: string; placeholder?: string; delay?: number;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onDebounced(draft.trim()), delay);
    return () => clearTimeout(t);
  }, [draft, value, delay, onDebounced]);
  return (
    <div className="relative w-full max-w-xs">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
      <Input aria-label={label} placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} className="pl-9" type="search" />
    </div>
  );
}

/** Filter row: children are the controls, and the result count sits at the end. */
export function FilterBar({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {children}
      {count !== undefined && <span className="ml-auto text-sm text-fg-muted tabular-nums">{count} {count === 1 ? 'result' : 'results'}</span>}
    </div>
  );
}

/** Previous and next paging by offset. */
export function Pagination({ skip, take, total, onSkip }: { skip: number; take: number; total: number; onSkip: (next: number) => void }) {
  if (total === 0) return null;
  const from = skip + 1;
  const to = Math.min(skip + take, total);
  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-fg-muted">
      <span className="tabular-nums">{from}–{to} of {total}</span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={skip === 0} onClick={() => onSkip(Math.max(0, skip - take))}>Previous</Button>
        <Button variant="secondary" size="sm" disabled={to >= total} onClick={() => onSkip(skip + take)}>Next</Button>
      </div>
    </nav>
  );
}
