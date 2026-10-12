'use client';

import { GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Me, homeFor, useMe } from '@/lib/auth';

const NAV_LINK = 'rounded-md px-3 py-2 text-sm font-medium text-[var(--mkt-body)] transition-colors hover:text-[var(--mkt-heading)]';

/**
 * Shared header for every public page (home, register, enroll, apply-teacher, verify). Transparent over the
 * hero, swaps to the canvas color once the page scrolls — a background shift only, no border or shadow, matching
 * the reference's measured behavior.
 */
export function PublicHeader() {
  const { data: me } = useMe();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`mkt mkt-header ${scrolled ? 'is-scrolled' : ''}`} style={{ background: scrolled ? 'var(--mkt-canvas)' : 'transparent' }}>
      <div className="mkt-container flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--mkt-blue)]">
          <span aria-hidden className="grid size-8 place-items-center rounded-full text-white" style={{ background: 'var(--mkt-blue-grad)' }}>
            <GraduationCap className="size-4.5" strokeWidth={1.75} />
          </span>
          <span className="font-display text-base font-extrabold text-[var(--mkt-heading)]">IELTS Academy</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          <Link href="/#course" className={`hidden sm:inline-block ${NAV_LINK}`}>The course</Link>
          <Link href="/#batches" className={`hidden md:inline-block ${NAV_LINK}`}>Batches</Link>
          <Link href="/#how" className={`hidden lg:inline-block ${NAV_LINK}`}>How it works</Link>
          <Link href="/#faq" className={`hidden lg:inline-block ${NAV_LINK}`}>FAQ</Link>
          <Link href="/apply-teacher" className={`hidden lg:inline-block ${NAV_LINK}`}>Teach with us</Link>
          {me ? (
            <Link href={homeFor(me as Me)} className="mkt-cta mkt-cta--dark mkt-cta--sm ml-2">My portal</Link>
          ) : (
            <>
              <Link href="/login" className={`${NAV_LINK} font-semibold`}>Log in</Link>
              <Link href="/register" className="mkt-cta mkt-cta--dark mkt-cta--sm ml-2">Enroll now</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
