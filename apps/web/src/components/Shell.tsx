'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useState } from 'react';
import { Me, useLogout } from '@/lib/auth';
import { NotificationBell } from './NotificationBell';

export interface NavItem { href: string; label: string; show?: boolean }
export interface NavGroup { title?: string; items: NavItem[] }

/** Sidebar + top bar shared by the student, mentor and admin areas. */
export function Shell({ title, groups, me, children }: { title: string; groups: NavGroup[]; me: Me; children: ReactNode }) {
  const path = usePathname();
  const logout = useLogout();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav aria-label="Main" className="space-y-5 px-3 py-4">
      {groups.map((g, i) => {
        const items = g.items.filter((it) => it.show !== false);
        if (!items.length) return null;
        return (
          <div key={g.title ?? i}>
            {g.title && <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.title}</p>}
            <ul className="space-y-0.5">
              {items.map((it) => {
                const active = path === it.href || (it.href !== '/' && path.startsWith(it.href + '/'));
                return (
                  <li key={it.href}>
                    <Link href={it.href} onClick={() => setOpen(false)} aria-current={active ? 'page' : undefined}
                      className={`block rounded-md px-3 py-2 text-sm font-medium ${active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100'}`}>
                      {it.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[16rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <aside className={`${open ? 'block' : 'hidden'} border-r border-slate-200 bg-white lg:block`}>
        <div className="px-6 py-5 text-lg font-semibold text-indigo-700">{title}</div>
        {nav}
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <button className="rounded-md p-2 text-slate-700 hover:bg-slate-100 lg:hidden" aria-expanded={open} aria-label="Toggle navigation" onClick={() => setOpen((v) => !v)}>☰</button>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <NotificationBell />
            <span className="hidden text-slate-600 sm:inline">{me.email}</span>
            <button onClick={logout} className="rounded-md px-3 py-1.5 font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">Log out</button>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
