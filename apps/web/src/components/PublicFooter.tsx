import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';

const PRODUCT_LINKS = [
  { href: '/#course', label: 'The course' },
  { href: '/curriculum', label: 'Curriculum' },
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

const LEGAL_LINKS = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
];

const ACCOUNT_LINKS = [
  { href: '/login', label: 'Log in' },
  { href: '/register', label: 'Enroll now' },
  { href: '/#faq', label: 'FAQ' },
];

const COL = 'text-xs font-bold tracking-wide text-fg-subtle uppercase';
const LINK_LIST = 'mt-4 flex flex-col gap-2.5 text-sm font-medium text-fg-muted';
const LINK = 'transition-colors hover:text-fg hover:underline';

/** Shared footer for every public page — homepage and the standalone marketing pages alike. */
export function PublicFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:px-8 sm:grid-cols-[1.3fr_1fr_1fr_1fr_1fr]">
        <div>
          <BrandLogo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-fg-muted">Teacher-led IELTS preparation across all four modules, with graded practice and mock tests in your own portal.</p>
        </div>
        <div>
          <p className={COL}>Product</p>
          <nav className={LINK_LIST}>{PRODUCT_LINKS.map((l) => <Link key={l.href} href={l.href} className={LINK}>{l.label}</Link>)}</nav>
        </div>
        <div>
          <p className={COL}>Company</p>
          <nav className={LINK_LIST}>{COMPANY_LINKS.map((l) => <Link key={l.href} href={l.href} className={LINK}>{l.label}</Link>)}</nav>
        </div>
        <div>
          <p className={COL}>Account</p>
          <nav className={LINK_LIST}>{ACCOUNT_LINKS.map((l) => <Link key={l.href} href={l.href} className={LINK}>{l.label}</Link>)}</nav>
        </div>
        <div>
          <p className={COL}>Legal</p>
          <nav className={LINK_LIST}>{LEGAL_LINKS.map((l) => <Link key={l.href} href={l.href} className={LINK}>{l.label}</Link>)}</nav>
        </div>
      </div>
      <div className="flex flex-col items-center gap-3 border-t border-border px-5 py-6 text-center text-sm text-fg-subtle sm:flex-row sm:justify-between sm:px-8">
        <p>© {new Date().getFullYear()} Connect IELTS Academy. All rights reserved.</p>
        <nav className="flex items-center gap-4">
          {LEGAL_LINKS.map((l) => <Link key={l.href} href={l.href} className="hover:text-fg hover:underline">{l.label}</Link>)}
        </nav>
      </div>
    </footer>
  );
}
