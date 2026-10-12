import Link from 'next/link';
import { ReactNode } from 'react';
import { BrandLogo } from '@/components/BrandLogo';

// Split layout: brand panel on large screens, a single centred column on small ones.
// The form itself keeps the app's standard components.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(40rem_24rem_at_0%_0%,rgb(42_68_148/.45),transparent),radial-gradient(30rem_20rem_at_100%_100%,rgb(18_165_148/.22),transparent)]" />
        <Link href="/" className="relative flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
          <BrandLogo tone="dark" />
        </Link>
        <div className="relative max-w-md">
          <h2 className="font-display text-h1 leading-tight text-white">Your classes, practice tests and course materials, in one place.</h2>
          <p className="mt-4 text-base leading-relaxed text-ink-fg/70">Sign in to continue where you left off.</p>
        </div>
        <p className="relative text-sm text-ink-fg/55">Teacher-led IELTS preparation</p>
      </aside>

      <main className="flex flex-col items-center justify-center px-4 py-12 sm:px-6">
        <Link href="/" className="mb-8 flex items-center gap-2 text-base font-extrabold lg:hidden">
          <BrandLogo />
        </Link>
        <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-lg ring-1 ring-border sm:p-8">{children}</div>
      </main>
    </div>
  );
}
