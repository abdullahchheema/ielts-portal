'use client';

import { ChevronsLeft, ChevronsRight, GraduationCap, LogOut, Menu, X, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { Avatar } from '@/components/ui';
import { cx } from '@/lib/cx';
import { Me, useLogout } from '@/lib/auth';
import { NotificationBell } from './NotificationBell';

export interface NavItem { href: string; label: string; show?: boolean; icon?: LucideIcon; badge?: number }
export interface NavGroup { title?: string; items: NavItem[] }

const COLLAPSE_KEY = 'ui:sidebar-collapsed';
const WIDTH = { default: 'max-w-6xl', wide: 'max-w-7xl', narrow: 'max-w-4xl' } as const;

/**
 * Sidebar and top bar shared by the student, teacher and admin areas.
 * A link is exact-match only when another nav item lives beneath it (e.g. /admin vs /admin/students),
 * so "Dashboard" is no longer highlighted on every page in its portal.
 */
export function Shell({ title, groups, me, children, width = 'default' }: { title: string; groups: NavGroup[]; me: Me; children: ReactNode; width?: keyof typeof WIDTH }) {
  const path = usePathname();
  const logout = useLogout();
  const [drawer, setDrawer] = useState(false);
  // Read synchronously: RequireAuth renders a spinner until `me` loads, so Shell never SSRs.
  const [collapsed, setCollapsed] = useState(() => {
    try { return typeof window !== 'undefined' && window.localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* storage may be blocked */ }
  }, [collapsed]);

  // Close the drawer on Escape and lock background scroll while it is open.
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [drawer]);

  const visible = groups.map((g) => ({ ...g, items: g.items.filter((it) => it.show !== false) })).filter((g) => g.items.length);
  const allHrefs = visible.flatMap((g) => g.items.map((i) => i.href));
  const isActive = (href: string) => {
    if (path === href) return true;
    const hasChildNav = allHrefs.some((h) => h !== href && h.startsWith(href + '/'));
    return !hasChildNav && href !== '/' && path.startsWith(href + '/');
  };

  const nav = (iconOnly: boolean) => (
    <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {visible.map((g, gi) => (
        <div key={g.title ?? gi}>
          {g.title && <p className={cx('mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle', iconOnly && 'lg:sr-only')}>{g.title}</p>}
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const active = isActive(it.href);
              const Icon = it.icon;
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={() => setDrawer(false)}
                    aria-current={active ? 'page' : undefined}
                    title={iconOnly ? it.label : undefined}
                    className={cx(
                      'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150',
                      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                      active ? 'bg-primary-soft text-primary' : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
                      iconOnly && 'lg:justify-center lg:px-0',
                    )}
                  >
                    {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-primary" />}
                    {Icon ? <Icon aria-hidden className="size-4.5 shrink-0" strokeWidth={1.75} /> : <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current opacity-40" />}
                    <span className={cx('min-w-0 flex-1 truncate', iconOnly && 'lg:sr-only')}>{it.label}</span>
                    {!!it.badge && <span className={cx('rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-fg', iconOnly && 'lg:hidden')}>{it.badge}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brand = (iconOnly: boolean) => (
    <div className={cx('flex items-center gap-3 px-5 pb-4 pt-5', iconOnly && 'lg:justify-center lg:px-0')}>
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-fg shadow-xs"><GraduationCap className="size-5" strokeWidth={1.75} /></span>
      <div className={cx('min-w-0', iconOnly && 'lg:sr-only')}>
        <p className="font-display text-sm font-semibold leading-tight text-fg">IELTS Academy</p>
        <p className="truncate text-xs text-fg-muted">{title}</p>
      </div>
    </div>
  );

  const profile = (iconOnly: boolean) => (
    <div className={cx('flex items-center gap-3 border-t border-border p-3', iconOnly && 'lg:flex-col lg:gap-2 lg:px-2')}>
      <Avatar email={me.email} />
      <div className={cx('min-w-0 flex-1', iconOnly && 'lg:hidden')}>
        <p className="truncate text-sm font-medium text-fg" title={me.email}>{me.email}</p>
        <p className="truncate text-xs text-fg-muted">{me.roles?.[0]?.replace(/_/g, ' ').toLowerCase() ?? 'Signed in'}</p>
      </div>
      <button type="button" onClick={logout} aria-label="Log out" title="Log out" className="grid size-8 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring">
        <LogOut aria-hidden className="size-4" />
      </button>
    </div>
  );

  return (
    <div className={cx('min-h-dvh bg-canvas lg:grid lg:transition-[grid-template-columns] lg:duration-200 lg:ease-out-soft', collapsed ? 'lg:grid-cols-[4.5rem_1fr]' : 'lg:grid-cols-[16rem_1fr]')}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-md">Skip to content</a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-surface lg:flex">
        {brand(collapsed)}
        {nav(collapsed)}
        {profile(collapsed)}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className="mx-3 mb-3 flex items-center justify-center gap-2 rounded-md py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          {collapsed ? <ChevronsRight aria-hidden className="size-4" /> : <><ChevronsLeft aria-hidden className="size-4" /><span>Collapse</span></>}
        </button>
      </aside>

      {/* Mobile drawer */}
      <div className={cx('fixed inset-0 z-40 bg-overlay transition-opacity duration-200 lg:hidden', drawer ? 'opacity-100' : 'pointer-events-none opacity-0')} onClick={() => setDrawer(false)} aria-hidden />
      <aside
        id="mobile-nav"
        role="dialog"
        aria-modal={drawer || undefined}
        aria-label="Navigation"
        aria-hidden={!drawer}
        className={cx('fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface shadow-xl transition-transform duration-200 ease-out-soft lg:hidden', drawer ? 'translate-x-0' : '-translate-x-full')}
      >
        <div className="flex items-center justify-between pr-3">
          {brand(false)}
          <button type="button" onClick={() => setDrawer(false)} aria-label="Close navigation" className="grid size-9 place-items-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring">
            <X aria-hidden className="size-5" />
          </button>
        </div>
        {nav(false)}
        {profile(false)}
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface/75 sm:px-6">
          <button
            type="button"
            className="grid size-9 place-items-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring lg:hidden"
            aria-expanded={drawer}
            aria-controls="mobile-nav"
            aria-label="Open navigation"
            onClick={() => setDrawer(true)}
          >
            <Menu aria-hidden className="size-5" />
          </button>
          <p className="min-w-0 flex-1 truncate font-display text-sm font-semibold text-fg lg:hidden">{title}</p>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
          </div>
        </header>
        <main id="main" className={cx('mx-auto w-full flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10', WIDTH[width])}>
          {children}
        </main>
      </div>
    </div>
  );
}
