'use client';

import Link from 'next/link';
import { ButtonHTMLAttributes, ReactNode, forwardRef } from "react";
import { cx } from '@/lib/cx';
import { Spinner } from './feedback';

export type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'cta';
export type Size = "xs" | "sm" | "md" | "lg" | "xl";
export type Tone = "default" | "danger";

const BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap ' +
  'transition-[background-color,box-shadow,color,transform] duration-[var(--dur-fast)] ease-out-soft ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
  'active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg shadow-sm hover:bg-primary-hover hover:shadow-md',
  secondary: 'bg-surface text-fg shadow-xs ring-1 ring-inset ring-border-strong hover:bg-surface-muted',
  danger: 'bg-danger text-white shadow-sm hover:brightness-95',
  ghost: "text-fg-muted hover:bg-surface-muted hover:text-fg",
  // Reserved for conversion CTAs: the one vivid accent in the system, used sparingly.
  cta: 'bg-accent text-accent-fg shadow-[var(--shadow-cta)] hover:bg-accent-hover hover:-translate-y-0.5',
};
const GHOST_DANGER = "text-danger hover:bg-danger-soft hover:text-danger";

// Padding-based sizing (not fixed heights) so existing `!py-*` overrides still work.
const SIZES: Record<Size, string> = {
  xs: 'px-2 py-1 text-xs rounded-lg gap-1',
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-6 py-3.5 text-base',
  xl: 'px-8 py-4 text-lead',
};

function variantCls(variant: Variant, tone: Tone) {
  return variant === "ghost" && tone === "danger" ? GHOST_DANGER : VARIANTS[variant];
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; busy?: boolean; tone?: Tone }>(function Button({ variant = "primary", size = "md", tone = "default", busy, className, children, disabled, ...rest }, ref) {
  return (
    <button
      {...rest}
      ref={ref}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(BASE, SIZES[size], variantCls(variant, tone), className)}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  );
});

export function LinkButton({ href, variant = 'primary', size = 'md', children, className }: { href: string; variant?: Variant; size?: Size; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cx(BASE, SIZES[size], VARIANTS[variant], className)}>
      {children}
    </Link>
  );
}
