'use client';

import { GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { cx } from '@/lib/cx';

/**
 * Single source of truth for the brand mark. Looks for a real asset in `public/brand/` at these paths:
 *   /brand/logo.png       — full lockup, for light backgrounds (header, light auth panel)
 *   /brand/logo-dark.png  — full lockup, for dark backgrounds (auth promo panel, dark footer)
 *   /brand/mark.png        — icon-only mark, for the collapsed sidebar rail and favicon-sized slots
 * These are plain <img> tags rather than next/image: the files may not exist yet, and a missing static
 * import would fail the build. Until the owner adds a file at one of these paths, onError swaps in the
 * current GraduationCap glyph so nothing breaks — no logo is ever invented.
 */
type Variant = 'full' | 'mark';
type Tone = 'light' | 'dark';

const SRC: Record<Variant, Record<Tone, string>> = {
  full: { light: '/brand/logo.png', dark: '/brand/logo-dark.png' },
  mark: { light: '/brand/mark.png', dark: '/brand/mark.png' },
};

export function BrandLogo({ variant = 'full', tone = 'light', className, markClassName }: { variant?: Variant; tone?: Tone; className?: string; markClassName?: string }) {
  const [failed, setFailed] = useState(false);
  const src = SRC[variant][tone];

  if (!failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="Connect IELTS Academy" className={cx(variant === 'mark' ? 'size-11' : 'h-11 sm:h-12', className)} onError={() => setFailed(true)} />
    );
  }

  if (variant === 'mark') {
    return (
      <span aria-hidden className={cx('grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-fg shadow-sm', markClassName)}>
        <GraduationCap className="size-6" strokeWidth={1.75} />
      </span>
    );
  }

  return (
    <span className={cx('inline-flex items-center gap-3', className)}>
      <span aria-hidden className={cx('grid size-11 shrink-0 place-items-center rounded-xl text-primary-fg shadow-sm', tone === 'dark' ? 'bg-white/15' : 'bg-primary')}>
        <GraduationCap className="size-6" strokeWidth={1.75} />
      </span>
      <span className={cx('text-lg font-extrabold', tone === 'dark' ? 'text-white' : 'text-fg')}>Connect IELTS Academy</span>
    </span>
  );
}
