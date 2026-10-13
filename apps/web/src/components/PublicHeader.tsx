'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BrandLogo } from '@/components/BrandLogo';
import { Me, homeFor, useMe } from '@/lib/auth';

const NAV_LINK = 'rounded-md px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg';

/**
 * Shared header for every public page (home, register, enroll, apply-teacher, verify). Transparent over the
 * hero, swaps to a solid surface with a hairline border once the page scrolls.
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
    <header className={`sticky top-0 z-30 transition-[background-color,border-color] duration-200 ${scrolled ? 'border-b border-border bg-surface/90 backdrop-blur-sm' : 'border-b border-transparent bg-transparent'}`}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
          <BrandLogo />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          <Link href="/#course" className={`hidden sm:inline-block ${NAV_LINK}`}>The course</Link>
          <Link href="/pricing" className={`hidden sm:inline-block ${NAV_LINK}`}>Pricing</Link>
          <Link href="/reviews" className={`hidden md:inline-block ${NAV_LINK}`}>Reviews</Link>
          <Link href="/free-tools" className={`hidden lg:inline-block ${NAV_LINK}`}>Free tools</Link>
          <Link href="/about" className={`hidden lg:inline-block ${NAV_LINK}`}>About</Link>
          <Link href="/#faq" className={`hidden xl:inline-block ${NAV_LINK}`}>FAQ</Link>
          {me ? (
            <Link href={homeFor(me as Me)} className="ml-2 inline-flex items-center rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg shadow-xs transition-colors hover:bg-primary-hover">My portal</Link>
          ) : (
            <>
              <Link href="/login" className={`${NAV_LINK} font-semibold`}>Log in</Link>
              <Link href="/register" className="ml-2 inline-flex items-center rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg shadow-xs transition-colors hover:bg-primary-hover">Enroll now</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
