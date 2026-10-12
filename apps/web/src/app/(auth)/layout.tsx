import { GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { ReactNode } from 'react';

// Split layout: brand panel on large screens, a single centred column on small ones. Matches the reference's
// login template (dark promo panel + white auth card); the form itself keeps the app's standard components.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mkt grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]" style={{ background: 'var(--mkt-canvas)' }}>
      <aside className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between" style={{ background: 'var(--mkt-dark-grad)' }}>
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(40rem_24rem_at_0%_0%,rgb(46_108_246/.35),transparent),radial-gradient(30rem_20rem_at_100%_100%,rgb(230_149_24/.18),transparent)]" />
        <Link href="/" className="relative flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
          <span aria-hidden className="grid size-9 place-items-center rounded-full text-white" style={{ background: 'var(--mkt-blue-grad)' }}><GraduationCap className="size-5" strokeWidth={1.75} /></span>
          <span className="text-base font-extrabold">IELTS Academy</span>
        </Link>
        <div className="relative max-w-md">
          <h2 className="text-3xl leading-tight text-white">Your classes, practice tests and course materials, in one place.</h2>
          <p className="mt-4 text-base leading-relaxed text-slate-300">Sign in to continue where you left off.</p>
        </div>
        <p className="relative text-sm text-slate-400">Teacher-led IELTS preparation</p>
      </aside>

      <main className="flex flex-col items-center justify-center px-4 py-12 sm:px-6">
        <Link href="/" className="mb-8 flex items-center gap-2 text-base font-extrabold lg:hidden">
          <span aria-hidden className="grid size-8 place-items-center rounded-full text-white" style={{ background: 'var(--mkt-blue-grad)' }}><GraduationCap className="size-4.5" strokeWidth={1.75} /></span>
          IELTS Academy
        </Link>
        <div className="mkt-card mkt-card--hero w-full max-w-md p-6 sm:p-8" style={{ background: 'var(--mkt-surface)' }}>{children}</div>
      </main>
    </div>
  );
}
