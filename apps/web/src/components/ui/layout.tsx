import Link from 'next/link';
import { ReactNode } from 'react';

export interface Crumb { href?: string; label: string }

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-fg-muted">
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="text-fg-subtle">/</span>}
            {c.href ? <Link href={c.href} className="rounded-sm hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring">{c.label}</Link> : <span aria-current="page" className="text-fg">{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({ title, subtitle, actions, breadcrumbs }: { title: string; subtitle?: string; actions?: ReactNode; breadcrumbs?: Crumb[] }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-border pb-6">
      <div className="min-w-0">
        {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-[1.7rem]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
