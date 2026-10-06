import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';

export interface TimelineEntry {
  id: string;
  title: string;
  at: string;
  body?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}

const DOT = { default: 'bg-fg-subtle', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' } as const;

/** Vertical history: stage transitions, grades, attendance corrections, notes. Pass entries newest first. */
export function Timeline({ entries, empty = 'Nothing recorded yet.' }: { entries: TimelineEntry[]; empty?: string }) {
  if (entries.length === 0) return <p className="text-sm text-fg-muted">{empty}</p>;
  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {entries.map((e) => (
        <li key={e.id} className="relative">
          <span className={cx('absolute -left-[1.45rem] top-1.5 size-2.5 rounded-full ring-4 ring-surface', DOT[e.tone ?? 'default'])} aria-hidden />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-sm font-medium text-fg">{e.title}</p>
            <time dateTime={e.at} className="text-xs tabular-nums text-fg-subtle">{new Date(e.at).toLocaleString()}</time>
          </div>
          {e.body && <div className="mt-1 text-sm text-fg-muted">{e.body}</div>}
        </li>
      ))}
    </ol>
  );
}
