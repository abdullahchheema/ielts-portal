import { BandScoreCalculator } from '@/components/BandScoreCalculator';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';

export const metadata = { title: 'Free IELTS tools — Connect IELTS Academy' };

export default function FreeToolsPage() {
  return (
    <div className="bg-canvas">
      <PublicHeader />
      <main>
        <section className="px-6 pt-14 pb-10 text-center">
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">Free, no signup</p>
          <h1 className="mx-auto mt-3 max-w-2xl font-display text-display text-fg">Free IELTS tools.</h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-fg-muted">
            No account needed. Start with the band score calculator below.
          </p>
        </section>

        <section className="px-6 pb-16 sm:pb-20">
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-5 text-center text-lg font-bold text-fg">Band score calculator</h2>
            <BandScoreCalculator />
          </div>
        </section>

        <section className="border-t border-border bg-surface px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-5xl text-center">
            <p className="text-xs font-semibold tracking-wide text-primary uppercase">Know your target?</p>
            <h2 className="mt-2 font-display text-h1 text-fg">Now practice to hit it.</h2>
            <p className="mx-auto mt-3 max-w-xl text-base text-fg-muted">Join a live batch for teacher-led classes, full mock tests and graded practice across all four modules.</p>
            <a href="/register" className="mt-6 inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-fg shadow-md transition-colors hover:bg-primary-hover">Join the next batch →</a>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
