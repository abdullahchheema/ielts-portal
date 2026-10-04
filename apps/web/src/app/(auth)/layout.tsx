import { GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { ReactNode } from 'react';

// Split layout: brand panel on large screens, a single centred column on small ones.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(40rem_24rem_at_0%_0%,rgb(37_99_235/.35),transparent),radial-gradient(30rem_20rem_at_100%_100%,rgb(20_184_166/.18),transparent)]" />
        <Link href="/" className="relative flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
          <span aria-hidden className="grid size-9 place-items-center rounded-md bg-surface/10 ring-1 ring-inset ring-white/15"><GraduationCap className="size-5" strokeWidth={1.75} /></span>
          <span className="font-display text-base font-semibold">IELTS Academy</span>
        </Link>
        <div className="relative max-w-md">
          <h2 className="font-display text-3xl font-semibold leading-tight tracking-tight">Your classes, practice tests and course materials, in one place.</h2>
          <p className="mt-4 text-base leading-relaxed text-slate-300">Sign in to continue where you left off.</p>
        </div>
        <p className="relative text-sm text-fg-subtle">Teacher-led IELTS preparation</p>
      </aside>

      <main className="flex flex-col items-center justify-center px-4 py-12 sm:px-6">
        <Link href="/" className="mb-8 flex items-center gap-2 font-display text-base font-semibold text-fg lg:hidden">
          <span aria-hidden className="grid size-8 place-items-center rounded-md bg-primary text-primary-fg"><GraduationCap className="size-4.5" strokeWidth={1.75} /></span>
          IELTS Academy
        </Link>
        <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-md ring-1 ring-border sm:p-8">{children}</div>
      </main>
    </div>
  );
}
