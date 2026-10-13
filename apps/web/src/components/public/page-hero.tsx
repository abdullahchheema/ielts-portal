import { ReactNode } from 'react';
import { HeroBackdrop } from '@/components/motion/hero-backdrop';
import { Reveal, Stagger, StaggerItem } from '@/components/motion/primitives';
import { cx } from '@/lib/cx';

export interface HeroCta { label: string; href: string }

const SIZE = {
  full: { section: 'pt-10 pb-24 sm:pt-14 sm:pb-32', title: 'text-display' },
  standard: { section: 'pt-8 pb-14 sm:pt-10 sm:pb-16', title: 'text-h1 sm:text-display' },
  compact: { section: 'pt-7 pb-10 sm:pt-8', title: 'text-h1' },
} as const;

/**
 * The one hero every public page shares — eyebrow, title, subtitle, CTA row,
 * in that rhythm, every time. `size` controls density; `align: 'split'` (home
 * only) puts `visual` beside the copy instead of below it. `compact` heroes
 * use a static backdrop (no drift) so a form sitting underneath doesn't jitter.
 */
export function PageHero({
  eyebrow, title, subtitle, primaryCta, secondaryCta, trust, visual, children,
  size = 'standard', align = 'center',
}: {
  eyebrow?: string; title: ReactNode; subtitle?: ReactNode;
  primaryCta?: HeroCta; secondaryCta?: HeroCta; trust?: ReactNode; visual?: ReactNode; children?: ReactNode;
  size?: keyof typeof SIZE; align?: 'center' | 'split';
}) {
  const s = SIZE[size];
  const split = align === 'split' && !!visual;

  const copy = (
    <Stagger className={cx(split ? 'text-center lg:text-left' : 'mx-auto max-w-2xl text-center')}>
      {eyebrow && (
        <StaggerItem>
          <p className="text-overline font-bold uppercase text-accent-strong">{eyebrow}</p>
        </StaggerItem>
      )}
      <StaggerItem>
        <h1 className={cx('font-display font-bold tracking-tight text-fg', eyebrow && 'mt-4', s.title)}>{title}</h1>
      </StaggerItem>
      {subtitle && (
        <StaggerItem>
          <p className={cx('mt-5 text-lead leading-relaxed text-fg-muted', split ? 'mx-auto lg:mx-0 max-w-xl' : 'mx-auto max-w-xl')}>{subtitle}</p>
        </StaggerItem>
      )}
      {(primaryCta || secondaryCta) && (
        <StaggerItem>
          <div className={cx('mt-9 flex flex-wrap items-center gap-4', split ? 'justify-center lg:justify-start' : 'justify-center')}>
            {primaryCta && (
              <a href={primaryCta.href} className="inline-flex items-center justify-center rounded-xl bg-accent px-8 py-4 text-lead font-bold text-accent-fg shadow-[var(--shadow-cta)] transition-[background-color,box-shadow,transform] duration-[--dur] ease-[--ease-out-soft] hover:bg-accent-hover hover:-translate-y-0.5">
                {primaryCta.label}
              </a>
            )}
            {secondaryCta && (
              <a href={secondaryCta.href} className="inline-flex items-center justify-center rounded-xl bg-surface px-7 py-4 text-base font-bold text-fg shadow-sm ring-1 ring-inset ring-border-strong transition-[background-color,box-shadow,transform] duration-[--dur] ease-[--ease-out-soft] hover:bg-surface-muted hover:-translate-y-0.5">
                {secondaryCta.label}
              </a>
            )}
          </div>
        </StaggerItem>
      )}
      {trust && (
        <StaggerItem>
          <div className={cx('mt-8', split ? 'flex flex-wrap items-center gap-3 justify-center lg:justify-start' : 'flex flex-wrap items-center justify-center gap-3')}>{trust}</div>
        </StaggerItem>
      )}
      {children && <StaggerItem>{children}</StaggerItem>}
    </Stagger>
  );

  return (
    <section className={cx('relative overflow-hidden px-5 sm:px-8', s.section)}>
      <HeroBackdrop drift={size !== 'compact'} />
      <div className="mx-auto max-w-6xl">
        {split ? (
          <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
            {copy}
            <Reveal delay={0.15}>{visual}</Reveal>
          </div>
        ) : copy}
      </div>
    </section>
  );
}
