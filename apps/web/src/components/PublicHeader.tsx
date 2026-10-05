'use client';

import { GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { LinkButton } from '@/components/ui';
import { Me, homeFor, useMe } from '@/lib/auth';

const NAV_LINK = 'rounded-md px-3 py-2 text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg';

export function PublicHeader() {
  const { data: me } = useMe();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
          <span aria-hidden className="grid size-8 place-items-center rounded-md bg-primary text-primary-fg"><GraduationCap className="size-4.5" strokeWidth={1.75} /></span>
          <span className="font-display text-base font-semibold text-fg">IELTS Academy</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm sm:gap-2">
          <Link href="/#course" className={`hidden sm:inline-block ${NAV_LINK}`}>The course</Link>
          <Link href="/#batches" className={`hidden md:inline-block ${NAV_LINK}`}>Batches</Link>
          <Link href="/#how" className={`hidden lg:inline-block ${NAV_LINK}`}>How it works</Link>
          <Link href="/apply-teacher" className={`hidden lg:inline-block ${NAV_LINK}`}>Teach with us</Link>
          {me ? (
            <LinkButton href={homeFor(me as Me)} size="sm" className="ml-1">My portal</LinkButton>
          ) : (
            <>
              <Link href="/login" className={`${NAV_LINK} font-medium`}>Log in</Link>
              <LinkButton href="/register" size="sm" className="ml-1">Enroll now</LinkButton>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
