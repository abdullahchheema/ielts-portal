'use client';

import { Menu, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BrandLogo } from '@/components/BrandLogo';
import { Me, homeFor, useMe } from '@/lib/auth';

const NAV_LINK = 'rounded-lg px-3.5 py-2 text-base font-semibold text-fg-muted transition-colors duration-[--dur-fast] ease-[--ease-out-soft] hover:bg-surface-muted hover:text-fg';
const NAV_LINKS = [
  { href: '/#course', label: 'The Course' },
  { href: '/curriculum', label: 'Curriculum' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/free-tools', label: 'Free tools' },
  { href: '/about', label: 'About' },
  { href: '/#faq', label: 'FAQ' },
];

/**
 * Shared header for every public page. Transparent over the hero, swaps to a
 * solid surface with a hairline border once the page scrolls. Collapses into
 * a full-screen sheet menu below `lg` — previously links just vanished.
 */
export function PublicHeader() {
  const { data: me } = useMe();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey); };
  }, [open]);

  const authCluster = me ? (
    <Link href={homeFor(me as Me)} onClick={() => setOpen(false)} className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-base font-semibold text-primary-fg shadow-sm transition-[background-color,box-shadow,transform] duration-[--dur] ease-[--ease-out-soft] hover:bg-primary-hover hover:shadow-md hover:-translate-y-px">My portal</Link>
  ) : (
    <>
      <Link href="/login" onClick={() => setOpen(false)} className={`${NAV_LINK} font-bold`}>Log in</Link>
      <Link href="/register" onClick={() => setOpen(false)} className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-base font-semibold text-primary-fg shadow-sm transition-[background-color,box-shadow,transform] duration-[--dur] ease-[--ease-out-soft] hover:bg-primary-hover hover:shadow-md hover:-translate-y-px">Enroll now</Link>
    </>
  );

  return (
    <header className={`sticky top-0 z-30 transition-[background-color,border-color] duration-[--dur] ease-[--ease-out-soft] ${scrolled || open ? 'border-b border-border bg-surface/90 backdrop-blur-sm' : 'border-b border-transparent bg-transparent'}`}>
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
          <BrandLogo />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((l) => <Link key={l.href} href={l.href} className={NAV_LINK}>{l.label}</Link>)}
          <span aria-hidden className="mx-2 h-6 w-px bg-border" />
          <div className="flex items-center gap-2">{authCluster}</div>
        </nav>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="grid size-11 shrink-0 place-items-center rounded-lg text-fg transition-colors hover:bg-surface-muted lg:hidden"
        >
          {open ? <X className="size-6" strokeWidth={1.75} /> : <Menu className="size-6" strokeWidth={1.75} />}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-border bg-surface shadow-lg lg:hidden"
          >
            <div className="px-5 pt-2 pb-6">
              <nav aria-label="Main (mobile)" className="flex flex-col gap-1">
                {NAV_LINKS.map((l) => <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className={`${NAV_LINK} w-full`}>{l.label}</Link>)}
              </nav>
              <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">{authCluster}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
