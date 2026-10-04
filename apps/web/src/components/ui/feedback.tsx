import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';
import { cx } from '@/lib/cx';

export function Spinner({ small }: { small?: boolean }) {
  return <span role="status" aria-label="Loading" className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', small ? 'size-4' : 'size-6')} />;
}

const ALERT: Record<'error' | 'success' | 'info' | 'warning', { box: string; icon: LucideIcon; iconCls: string }> = {
  error: { box: 'bg-danger-soft ring-danger/25', icon: CircleAlert, iconCls: 'text-danger' },
  success: { box: 'bg-success-soft ring-success/25', icon: CircleCheck, iconCls: 'text-success' },
  info: { box: 'bg-info-soft ring-info/25', icon: Info, iconCls: 'text-info' },
  warning: { box: 'bg-warning-soft ring-warning/30', icon: TriangleAlert, iconCls: 'text-warning' },
};

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info' | 'warning'; children: ReactNode }) {
  const s = ALERT[kind];
  const Icon = s.icon;
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-md px-4 py-3 text-sm text-fg ring-1 ring-inset', s.box)}>
      <Icon aria-hidden className={cx('mt-0.5 size-4 shrink-0', s.iconCls)} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Dashed placeholder. Plain children still work; icon, title and action are optional. */
export function Empty({ icon: Icon, title, children, action }: { icon?: LucideIcon; title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface px-6 py-10 text-center">
      {Icon && <span className="mb-1 grid size-10 place-items-center rounded-full bg-surface-muted text-fg-muted"><Icon aria-hidden className="size-5" /></span>}
      {title && <p className="font-semibold text-fg">{title}</p>}
      {children && <div className="max-w-md text-sm text-fg-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Loading() {
  return <div className="flex justify-center p-10 text-fg-muted"><Spinner /></div>;
}

const SKELETON = 'animate-pulse rounded-md bg-surface-muted';
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx(SKELETON, className)} />;
}
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-2">
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={cx('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />)}
    </div>
  );
}
export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Loading" className="overflow-hidden rounded-lg bg-surface ring-1 ring-border">
      <div className="flex gap-6 border-b border-border bg-surface-muted px-4 py-3">
        {Array.from({ length: cols }, (_, i) => <Skeleton key={i} className="h-3 flex-1" />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-6 border-b border-border px-4 py-3.5 last:border-0">
          {Array.from({ length: cols }, (_, c) => <Skeleton key={c} className={cx('h-3.5 flex-1', c === 0 && 'max-w-[40%]')} />)}
        </div>
      ))}
    </div>
  );
}
export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
    </div>
  );
}

export function ProgressBar({ value, label: text }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div>
      {text && <div className="mb-1.5 flex justify-between text-xs text-fg-muted"><span>{text}</span><span className="tabular-nums">{Math.round(v)}%</span></div>}
      <div role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={text ?? 'Progress'} className="h-2 overflow-hidden rounded-full bg-surface-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out-soft" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

/** Circular progress for a single headline figure (e.g. overall course completion). */
export function ProgressRing({ value, size = 64, label: text }: { value: number; size?: number; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={text ?? 'Progress'} className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} className="stroke-surface-muted" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} strokeLinecap="round" className="stroke-primary transition-[stroke-dashoffset] duration-300 ease-out-soft" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} />
      </svg>
      <span className="absolute text-sm font-semibold tabular-nums text-fg">{Math.round(v)}%</span>
    </div>
  );
}
