import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';

const PRODUCT_LINKS = [
  { href: '/#course', label: 'The course' },
  { href: '/#batches', label: 'Batches' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/#how', label: 'How it works' },
];

const COMPANY_LINKS = [
  { href: '/about', label: 'About' },
  { href: '/reviews', label: 'Student reviews' },
  { href: '/free-tools', label: 'Free tools' },
  { href: '/apply-teacher', label: 'Teach with us' },
];

const ACCOUNT_LINKS = [
  { href: '/login', label: 'Log in' },
  { href: '/register', label: 'Enroll now' },
  { href: '/#faq', label: 'FAQ' },
];

/** Shared footer for every public page — homepage and the standalone marketing pages alike. */
export function PublicFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 sm:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div>
          <BrandLogo />
          <p className="mt-3 max-w-xs text-sm text-fg-muted">Teacher-led IELTS preparation across all four modules, with graded practice and mock tests in your own portal.</p>
        </div>
        <div>
          <p className="text-xs font-bold tracking-wide text-fg-subtle uppercase">Product</p>
          <nav className="mt-3 flex flex-col gap-2 text-sm text-fg-muted">
            {PRODUCT_LINKS.map((l) => <Link key={l.href} href={l.href} className="hover:text-fg hover:underline">{l.label}</Link>)}
          </nav>
        </div>
        <div>
          <p className="text-xs font-bold tracking-wide text-fg-subtle uppercase">Company</p>
          <nav className="mt-3 flex flex-col gap-2 text-sm text-fg-muted">
            {COMPANY_LINKS.map((l) => <Link key={l.href} href={l.href} className="hover:text-fg hover:underline">{l.label}</Link>)}
          </nav>
        </div>
        <div>
          <p className="text-xs font-bold tracking-wide text-fg-subtle uppercase">Account</p>
          <nav className="mt-3 flex flex-col gap-2 text-sm text-fg-muted">
            {ACCOUNT_LINKS.map((l) => <Link key={l.href} href={l.href} className="hover:text-fg hover:underline">{l.label}</Link>)}
          </nav>
        </div>
      </div>
      <div className="border-t border-border py-6 text-center text-xs text-fg-subtle">
        © {new Date().getFullYear()} Connect IELTS Academy. All rights reserved.
      </div>
    </footer>
  );
}
