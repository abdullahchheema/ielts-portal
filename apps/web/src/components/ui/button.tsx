'use client';

import Link from 'next/link';
import { ButtonHTMLAttributes, ReactNode, forwardRef } from "react";
import { cx } from '@/lib/cx';
import { Spinner } from './feedback';

export type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type Size = "sm" | "md" | "lg";
export type Tone = "default" | "danger";

const BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap ' +
  'transition-[background-color,box-shadow,color] duration-150 ease-out-soft ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-55';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg shadow-xs hover:bg-primary-hover',
  secondary: 'bg-surface text-fg shadow-xs ring-1 ring-inset ring-border-strong hover:bg-surface-muted',
  danger: 'bg-danger text-white shadow-xs hover:brightness-95',
  ghost: "text-fg-muted hover:bg-surface-muted hover:text-fg",
};
const GHOST_DANGER = "text-danger hover:bg-danger-soft hover:text-danger";

// Padding-based sizing (not fixed heights) so existing `!py-*` overrides still work.
const SIZES: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3.5 py-2 text-sm',
  lg: 'px-5 py-3 text-base',
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
