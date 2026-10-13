import { Star } from 'lucide-react';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';

export const metadata = { title: 'Student reviews — IELTS Academy' };

/**
 * Placeholder reviews. Replace every entry here with a real, permissioned student testimonial
 * (name, country, before/after band, quote) as they come in — do not present these samples as genuine.
 */
const REVIEWS: { name: string; country: string; quote: string; before: string; after: string; module?: string }[] = [
  { name: 'Sample student', country: 'Pakistan', quote: 'The weekly timetable kept me honest. I knew exactly what I was behind on and what to fix next.', before: '6.0', after: '7.0' },
  { name: 'Sample student', country: 'Pakistan', quote: 'My teacher caught coherence problems in my essays that no amount of self-study would have shown me.', before: '6.5', after: '7.5', module: 'Writing' },
  { name: 'Sample student', country: 'Pakistan', quote: 'Mock tests under real timing were the single biggest reason test day did not feel unfamiliar.', before: '5.5', after: '6.5' },
  { name: 'Sample student', country: 'Pakistan', quote: 'Payment was checked within a day and I was in class that same week. No chasing anyone for access.', before: '6.0', after: '7.0' },
  { name: 'Sample student', country: 'Pakistan', quote: 'Speaking practice with recorded feedback made the biggest difference — I could hear what the teacher meant.', before: '6.0', after: '7.0', module: 'Speaking' },
  { name: 'Sample student', country: 'Pakistan', quote: 'One course, one clear path. I was not juggling five different apps to prepare.', before: '6.5', after: '7.5' },
];

export default function ReviewsPage() {
  return (
    <div className="bg-canvas">
      <PublicHeader />
      <main>
        <section className="px-6 pt-14 pb-10 text-center">
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">Student reviews</p>
          <h1 className="mx-auto mt-3 max-w-2xl font-display text-display text-fg">Real students. Real band jumps.</h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-fg-muted">
            The cards below show the kind of feedback we collect and how we present it — each one is a sample, clearly marked, until it is replaced with a named, permissioned review.
          </p>
        </section>

        <section className="px-6 pb-16 sm:pb-20">
          <div className="mx-auto max-w-5xl">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {REVIEWS.map((r, i) => (
                <div key={i} className="flex flex-col rounded-lg bg-surface p-6 shadow-xs ring-1 ring-border">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-0.5 text-amber-400">
                      {Array.from({ length: 5 }).map((_, j) => <Star key={j} className="size-4" fill="currentColor" strokeWidth={0} />)}
                    </div>
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold tracking-wide text-fg-subtle uppercase">Sample</span>
                  </div>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-fg">&ldquo;{r.quote}&rdquo;</p>
                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                    <div>
                      <p className="text-sm font-semibold text-fg">{r.name}</p>
                      <p className="text-xs text-fg-subtle">{r.country}{r.module ? ` · ${r.module} focus` : ''}</p>
                    </div>
                    <div className="text-right text-sm font-bold text-accent-strong">{r.before} → {r.after}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border bg-surface px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="font-display text-h1 text-fg">Already a student?</h2>
            <p className="mx-auto mt-3 max-w-xl text-base text-fg-muted">If this course helped you, we would love to feature your real score and story here — with your permission.</p>
            <a href="/student/support" className="mt-6 inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-fg shadow-md transition-colors hover:bg-primary-hover">Share your story</a>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
