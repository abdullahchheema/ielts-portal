import { CalendarDays, Users } from 'lucide-react';
import { Star } from 'lucide-react';
import { PublicBatch } from '@/components/BatchCard';
import { Reveal, Stagger, StaggerItem } from '@/components/motion/primitives';
import { PageHero } from '@/components/public/page-hero';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';
import { date } from '@/lib/format';
import { publicGet } from '@/lib/server-api';

export const revalidate = 120;
export const metadata = { title: 'Student reviews — Connect IELTS Academy' };

const DAY: Record<string, string> = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };

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

export default async function ReviewsPage() {
  const batches = await publicGet<PublicBatch[]>('/public/batches', 120);
  const running = batches?.filter((b) => b.status === 'IN_PROGRESS') ?? [];

  return (
    <div className="bg-canvas">
      <PublicHeader />
      <main>
        <PageHero
          size="standard"
          className="bg-wash"
          eyebrow="Student reviews"
          title="Real students. Real band jumps."
          subtitle="The cards below show the kind of feedback we collect and how we present it — each one is a sample, clearly marked, until it is replaced with a named, permissioned review."
        />

        <section className="px-5 pt-6 pb-20 sm:px-8 sm:pt-8 sm:pb-24">
          <div className="mx-auto max-w-5xl">
            <Stagger className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {REVIEWS.map((r, i) => (
                <StaggerItem key={i} className="flex flex-col rounded-2xl bg-surface p-7 shadow-sm ring-1 ring-border">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-0.5 text-amber-400">
                      {Array.from({ length: 5 }).map((_, j) => <Star key={j} className="size-4" fill="currentColor" strokeWidth={0} />)}
                    </div>
                    <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[10px] font-bold tracking-wide text-fg-subtle uppercase">Sample</span>
                  </div>
                  <p className="mt-4 flex-1 text-sm leading-relaxed text-fg">&ldquo;{r.quote}&rdquo;</p>
                  <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                    <div>
                      <p className="text-sm font-bold text-fg">{r.name}</p>
                      <p className="text-xs text-fg-subtle">{r.country}{r.module ? ` · ${r.module} focus` : ''}</p>
                    </div>
                    <div className="text-right text-sm font-bold text-accent-strong">{r.before} → {r.after}</div>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        {running.length > 0 && (
          <section className="border-t border-border bg-surface px-5 py-20 sm:px-8 sm:py-24">
            <Reveal className="mx-auto max-w-5xl">
              <div className="mb-10 text-center">
                <p className="text-overline font-bold text-primary uppercase">Right now</p>
                <h2 className="mt-2 font-display text-h1 text-fg">Batches currently underway.</h2>
                <p className="mx-auto mt-3 max-w-xl text-lead text-fg-muted">Real, running classes — not projected numbers. These batches are already in progress with their teacher.</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {running.map((b) => (
                  <div key={b.id} className="rounded-2xl bg-canvas p-6 shadow-sm ring-1 ring-border">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-display text-base font-bold text-fg">{b.name}</h3>
                      <span className="shrink-0 rounded-full bg-info-soft px-2.5 py-1 text-xs font-bold text-info ring-1 ring-inset ring-info/20">Running</span>
                    </div>
                    <div className="mt-4 space-y-2 text-sm text-fg-muted">
                      <p className="flex items-center gap-2"><CalendarDays className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />Started {date(b.startAt)}</p>
                      <p className="flex items-center gap-2"><Users className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />{b.mentorAssigned ? b.mentors.map((m) => m.name).join(', ') : 'Teacher not assigned yet'}</p>
                    </div>
                    {b.days.length > 0 && <p className="mt-3 border-t border-border pt-3 text-xs text-fg-subtle">{b.days.map((d) => DAY[d] ?? d).join(', ')}{b.classTime ? ` · ${b.classTime}` : ''}</p>}
                  </div>
                ))}
              </div>
            </Reveal>
          </section>
        )}

        <section className="border-t border-border bg-surface px-5 py-20 sm:px-8 sm:py-24">
          <Reveal className="mx-auto max-w-3xl text-center">
            <h2 className="font-display text-h1 text-fg">Already a student?</h2>
            <p className="mx-auto mt-3 max-w-xl text-lead text-fg-muted">If this course helped you, we would love to feature your real score and story here — with your permission.</p>
            <a href="/student/support" className="mt-7 inline-flex items-center justify-center rounded-xl bg-primary px-7 py-4 text-base font-bold text-primary-fg shadow-sm transition-[background-color,box-shadow,transform] duration-[--dur] ease-[--ease-out-soft] hover:bg-primary-hover hover:shadow-md hover:-translate-y-0.5">Share your story</a>
          </Reveal>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
