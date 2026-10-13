import { ReactNode } from 'react';
import { Reveal } from '@/components/motion/primitives';
import { PageHero } from '@/components/public/page-hero';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';

/** Shared shell for long-form legal pages (Terms, Privacy): the standard hero, a prose container, and the footer. */
export function LegalLayout({ eyebrow, title, updated, children }: { eyebrow: string; title: string; updated: string; children: ReactNode }) {
  return (
    <div className="bg-canvas">
      <PublicHeader />
      <main>
        <PageHero size="compact" className="bg-wash" eyebrow={eyebrow} title={title} subtitle={`Last updated ${updated}`} />
        <Reveal className="mx-auto max-w-3xl px-5 pb-20 sm:px-8 sm:pb-24">
          <div className="legal-prose rounded-3xl bg-surface p-8 shadow-sm ring-1 ring-border sm:p-10">
            {children}
          </div>
        </Reveal>
      </main>
      <PublicFooter />
    </div>
  );
}
