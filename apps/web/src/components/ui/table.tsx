'use client';

import { ReactNode } from 'react';
import { cx } from '@/lib/cx';

export function TableToolbar({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}

/** Scrollable on narrow screens; the header row stays put on desktop when `sticky` is set. */
export function Table({ head, children, sticky }: { head: string[]; children: ReactNode; sticky?: boolean }) {
  return (
    <div className="max-w-full overflow-x-auto rounded-lg bg-surface shadow-xs ring-1 ring-border">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className={cx('bg-surface-muted', sticky && 'sticky top-0 z-[1]')}>
          <tr>{head.map((h) => <th key={h} scope="col" className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cx('px-4 py-3 align-middle text-fg', className)}>{children}</td>;

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
