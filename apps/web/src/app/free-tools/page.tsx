import { BandScoreCalculator } from '@/components/BandScoreCalculator';
import { Reveal } from '@/components/motion/primitives';
import { PageHero } from '@/components/public/page-hero';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';

export const metadata = { title: 'Free IELTS tools — Connect IELTS Academy' };

export default function FreeToolsPage() {
  return (
    <div className="bg-canvas">
      <PublicHeader />
      <main>
        <PageHero
          size="standard"
          className="bg-wash"
          eyebrow="Free, no signup"
          title="Free IELTS tools."
          subtitle="No account needed. Start with the band score calculator below."
        />

        <section className="px-5 pt-6 pb-20 sm:px-8 sm:pt-8 sm:pb-24">
          <Reveal className="mx-auto max-w-2xl">
            <h2 className="mb-6 text-center text-xl font-bold text-fg">Band score calculator</h2>
            <BandScoreCalculator />
          </Reveal>
        </section>

        <section className="border-t border-border bg-surface px-5 py-20 sm:px-8 sm:py-24">
          <Reveal className="mx-auto max-w-5xl text-center">
            <p className="text-overline font-bold text-primary uppercase">Know your target?</p>
            <h2 className="mt-2 font-display text-h1 text-fg">Now practice to hit it.</h2>
            <p className="mx-auto mt-3 max-w-xl text-lead text-fg-muted">Join a live batch for teacher-led classes, full mock tests and graded practice across all four modules.</p>
            <a href="/register" className="mt-7 inline-flex items-center justify-center rounded-xl bg-accent px-8 py-4 text-lead font-bold text-accent-fg shadow-[var(--shadow-cta)] transition-[background-color,box-shadow,transform] duration-[--dur] ease-[--ease-out-soft] hover:bg-accent-hover hover:-translate-y-0.5">Start preparing today →</a>
          </Reveal>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
