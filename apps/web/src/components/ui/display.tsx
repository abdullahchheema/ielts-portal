import { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { ReactNode } from 'react';
import { label } from '@/lib/format';
import { cx } from '@/lib/cx';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-lg bg-surface p-5 shadow-xs ring-1 ring-border', className)}>{children}</div>;
}

/** Headline figure with an optional action-needed emphasis and link. */
export function StatCard({ label: text, value, href, hint, icon: Icon, attention }: {
  label: string; value: ReactNode; href?: string; hint?: string; icon?: LucideIcon; attention?: boolean;
}) {
  const body = (
    <Card className={cx('h-full transition-[box-shadow,ring-color] duration-150 hover:shadow-xs', attention && 'ring-2 ring-warning/60', href && 'hover:ring-border-strong')}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-fg-muted">{text}</p>
        {Icon && <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary-soft text-primary"><Icon aria-hidden className="size-4" /></span>}
      </div>
      <p className="mt-2 font-display text-3xl font-semibold tracking-tight tabular-nums text-fg">{value}</p>
      {hint && <p className="mt-1 text-xs text-fg-subtle">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{body}</Link> : body;
}

const TONE: Record<string, string> = {
  ACTIVE: 'green', PAID: 'green', APPROVED: 'green', OPEN: 'green', COMPLETED: 'blue', PUBLISHED: 'green', CONFIRMED: 'green',
  PENDING_REVIEW: 'amber', SUBMITTED: 'amber', AWAITING_PAYMENT: 'amber', UNDER_REVIEW: 'amber', HELD: 'amber', DRAFT: 'slate', PENDING: 'amber',
  PENDING_PAYMENT: 'amber', IN_PROGRESS: 'blue', PAUSED: 'amber', PENDING_VERIFICATION: 'amber',
  REJECTED: 'red', CANCELLED: 'red', EXPIRED: 'red', SUSPENDED: 'red', BLOCKED: 'red', REFUNDED: 'red', LOCKED: 'slate', RETIRED: 'slate', ARCHIVED: 'slate',
};
// Text uses the -800 shades for AA contrast on the soft fills.
const TONE_CLS: Record<string, string> = {
  green: 'bg-success-soft text-green-800 ring-green-600/20',
  amber: 'bg-warning-soft text-amber-800 ring-amber-600/20',
  red: 'bg-danger-soft text-red-800 ring-red-600/20',
  blue: 'bg-info-soft text-sky-800 ring-sky-600/20',
  purple: 'bg-purple-50 text-purple-800 ring-purple-600/20',
  slate: 'bg-surface-muted text-fg-muted ring-border-strong',
};

export function Badge({ status, tone, text }: { status: string; tone?: keyof typeof TONE_CLS; text?: string }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', TONE_CLS[tone ?? TONE[status] ?? 'slate'])}>{text ?? label(status)}</span>;
}

/** Initials from the email local part. `Me` carries no name, so this is all we have. */
export function Avatar({ email, size = 'md' }: { email: string; size?: 'sm' | 'md' }) {
  const base = email.split('@')[0] ?? '';
  const parts = base.split(/[._-]+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? base[1] ?? '')).toUpperCase() || '?';
  return (
    <span aria-hidden className={cx('inline-grid shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary ring-1 ring-inset ring-primary/15', size === 'sm' ? 'size-7 text-xs' : 'size-9 text-sm')}>
      {initials}
    </span>
  );
}

export function DefinitionList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium text-fg-muted">{it.label}</dt>
          <dd className="mt-1 text-sm text-fg break-words">{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, description, actions, children, className }: { title?: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('mb-8 last:mb-0', className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            {title && <h3 className="text-base font-semibold text-fg">{title}</h3>}
            {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
