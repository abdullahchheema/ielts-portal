'use client';

import Link from 'next/link';
import { Me, homeFor, useMe } from '@/lib/auth';

export function PublicHeader() {
  const { data: me } = useMe();
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5">
        <Link href="/" className="text-lg font-semibold text-indigo-700">IELTS Academy</Link>
        <nav aria-label="Main" className="flex items-center gap-4 text-sm">
          <Link href="/#course" className="hidden text-slate-700 hover:text-indigo-700 sm:inline">The course</Link>
          <Link href="/#batches" className="hidden text-slate-700 hover:text-indigo-700 sm:inline">Batches</Link>
          <Link href="/#how" className="hidden text-slate-700 hover:text-indigo-700 md:inline">How it works</Link>
          <Link href="/apply-teacher" className="hidden text-slate-700 hover:text-indigo-700 lg:inline">Teach with us</Link>
          {me ? (
            <Link href={homeFor(me as Me)} className="rounded-md bg-indigo-600 px-3.5 py-2 font-medium text-white hover:bg-indigo-700">My portal</Link>
          ) : (
            <>
              <Link href="/login" className="text-slate-700 hover:text-indigo-700">Log in</Link>
              <Link href="/register" className="rounded-md bg-indigo-600 px-3.5 py-2 font-medium text-white hover:bg-indigo-700">Enroll Now</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
