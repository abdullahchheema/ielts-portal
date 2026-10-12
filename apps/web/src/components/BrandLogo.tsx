'use client';

import { GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { cx } from '@/lib/cx';

/**
 * Single source of truth for the brand mark. Looks for a real asset in `public/brand/` at these paths:
 *   /brand/logo.svg       — full lockup, for light backgrounds (header, light auth panel)
 *   /brand/logo-dark.svg  — full lockup, for dark backgrounds (auth promo panel, dark footer)
 *   /brand/mark.svg       — icon-only mark, for the collapsed sidebar rail and favicon-sized slots
 * These are plain <img> tags rather than next/image: the files may not exist yet, and a missing static
 * import would fail the build. Until the owner adds a file at one of these paths, onError swaps in the
 * current GraduationCap glyph so nothing breaks — no logo is ever invented.
 */
type Variant = 'full' | 'mark';
type Tone = 'light' | 'dark';

const SRC: Record<Variant, Record<Tone, string>> = {
  full: { light: '/brand/logo.svg', dark: '/brand/logo-dark.svg' },
  mark: { light: '/brand/mark.svg', dark: '/brand/mark.svg' },
};

export function BrandLogo({ variant = 'full', tone = 'light', className, markClassName }: { variant?: Variant; tone?: Tone; className?: string; markClassName?: string }) {
  const [failed, setFailed] = useState(false);
  const src = SRC[variant][tone];

  if (!failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="IELTS Academy" className={cx(variant === 'mark' ? 'size-9' : 'h-8', className)} onError={() => setFailed(true)} />
    );
  }

  if (variant === 'mark') {
    return (
      <span aria-hidden className={cx('grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-fg shadow-xs', markClassName)}>
        <GraduationCap className="size-5" strokeWidth={1.75} />
      </span>
    );
  }

  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <span aria-hidden className={cx('grid size-9 shrink-0 place-items-center rounded-lg text-primary-fg shadow-xs', tone === 'dark' ? 'bg-white/15' : 'bg-primary')}>
        <GraduationCap className="size-5" strokeWidth={1.75} />
      </span>
      <span className={cx('text-base font-extrabold', tone === 'dark' ? 'text-white' : 'text-fg')}>IELTS Academy</span>
    </span>
  );
}
