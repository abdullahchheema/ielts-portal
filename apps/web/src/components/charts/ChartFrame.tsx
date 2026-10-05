'use client';

import { useState, type ReactNode } from 'react';
import { Empty } from '@/components/ui';

export interface TableColumn<T> { key: keyof T & string; label: string; format?: (v: T[keyof T & string]) => string }

/**
 * Every chart in the app is wrapped in this frame. It gives every chart a table alternative, which
 * is the real accessibility story: a chart is never the only way to read the numbers.
 */
export function ChartFrame<T extends Record<string, unknown>>({ title, description, rows, columns, empty, emptyText = 'No data for this period yet.', children }: {
  title: string; description?: string; rows: T[]; columns: TableColumn<T>[]; empty?: boolean; emptyText?: string; children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  if (empty) return <Empty title={title}>{emptyText}</Empty>;
  return (
    <figure className="rounded-lg bg-surface p-5 shadow-xs ring-1 ring-border">
      <figcaption className="mb-4">
        <p className="font-display text-sm font-semibold text-fg">{title}</p>
        {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </figcaption>
      {showTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="text-xs text-fg-muted">{columns.map((c) => <th key={c.key} scope="col" className="py-1 font-medium">{c.label}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                {columns.map((c) => <td key={c.key} className="py-1.5 tabular-nums">{c.format ? c.format(r[c.key]) : String(r[c.key] ?? '')}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="h-64 w-full">{children}</div>
      )}
      <button type="button" className="mt-3 text-xs font-medium text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>
        {showTable ? 'Show chart' : 'Show as table'}
      </button>
    </figure>
  );
}
