'use client';

import { Children, ReactNode, cloneElement, isValidElement } from 'react';
import { cx } from '@/lib/cx';

export function TableToolbar({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}

interface TdProps { children?: ReactNode; className?: string; label?: string }

/** Cell. `label` is filled in by Table from the header, and drives the stacked mobile layout. */
export const Td = ({ children, className, label }: TdProps) => (
  <td data-label={label} className={cx('px-4 py-3 align-middle text-fg', className)}>{children}</td>
);

/** Copies header names onto each cell so they can be shown as labels when the table stacks. */
function labelRow(row: ReactNode, head: string[]): ReactNode {
  if (!isValidElement<{ children?: ReactNode }>(row)) return row;
  return cloneElement(row, undefined, Children.map(row.props.children, (cell, i) =>
    isValidElement<TdProps>(cell) && cell.type === Td ? cloneElement(cell, { label: head[i] }) : cell,
  ));
}

/**
 * Columns from md up; below lg each row becomes a stacked card with labelled values.
 * No horizontal scrolling at any width: the table never overflows its container.
 */
export function Table({ head, children, sticky }: { head: string[]; children: ReactNode; sticky?: boolean }) {
  return (
    <div className="rounded-lg bg-surface shadow-xs ring-1 ring-border">
      <table className="data-table w-full text-sm">
        <thead className={cx('bg-surface-muted', sticky && 'sticky top-0 z-[1]')}>
          <tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">{Children.map(children, (row) => labelRow(row, head))}</tbody>
      </table>
    </div>
  );
}

export function ClickableRow({ onClick, children, className }: { onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <tr
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      role="button"
      tabIndex={0}
      className={cx('cursor-pointer transition-colors duration-150 hover:bg-primary-soft/40 focus-visible:bg-primary-soft/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring', className)}
    >
      {children}
    </tr>
  );
}
