import { CalendarClock, CalendarDays, CheckCircle2, ClipboardCheck, ScrollText, Star, Target, TrendingUp, UserCheck, Users, Wallet } from 'lucide-react';
import { BatchCard, PublicBatch } from '@/components/BatchCard';
import { FaqAccordion, FeatureShowcase } from '@/components/MarketingInteractive';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';
import { Empty } from '@/components/ui';
import { money } from '@/lib/format';
import { PublicCourse, publicGet } from '@/lib/server-api';

export const revalidate = 120; // batches change, but not every second — ISR beats force-dynamic

const TRUST_BADGES = [
  { icon: Users, text: 'Teacher-led classes, every week' },
  { icon: ClipboardCheck, text: 'All four modules, one course' },
  { icon: Wallet, text: 'Payments checked by a person' },
];

/**
 * Headline stats for the hero strip. Placeholder figures — swap for verified numbers
 * (enrollment count, pass rate, average improvement) before this goes live.
 */
const STATS = [
  { value: '2,500+', label: 'students coached' },
  { value: '94%', label: 'hit their target band' },
  { value: '+1.8', label: 'bands average improvement' },
  { value: '4.9/5', label: 'average student rating' },
];

// Real features we have built, not a marketing wishlist.
const TOOLS = [
  { icon: Target, title: 'Personalized study plan', text: 'Built from your practice and your weakest skills, and updated as you go.' },
  { icon: ScrollText, title: 'Full mock tests', text: 'Timed, all four modules, with an estimated band at the end.' },
  { icon: TrendingUp, title: 'Progress you can see', text: 'A readiness estimate and a skill-by-skill history, not just a single score.' },
];

/** Placeholder reviews — replace with real, permissioned student testimonials. See /reviews. */
const REVIEW_TEASER = [
  { quote: 'The teacher feedback on my Writing Task 2 was the thing that actually moved my score — not generic tips, specific line-by-line fixes.', name: 'Sample student', band: '6.5 → 7.5' },
  { quote: 'Having a fixed weekly timetable kept me accountable. The mock tests felt exactly like test day.', name: 'Sample student', band: '6.0 → 7.0' },
  { quote: 'I liked that a real person checked my payment and I was in my first class the same week.', name: 'Sample student', band: '5.5 → 6.5' },
];

const STEPS = [
  { title: 'Choose a batch', text: 'Pick the start date and class timing that suit your week.' },
  { title: 'Register', text: 'Tell us who you are and your current level.' },
  { title: 'Pay and upload proof', text: 'Pay by bank transfer, JazzCash or Easypaisa and attach your receipt.' },
  { title: 'We verify your payment', text: 'The academy checks it, usually within one working day.' },
  { title: 'Start learning', text: 'You are enrolled and your student portal opens.' },
];

const FAQ = [
  { q: 'Do I need any previous IELTS experience?', a: 'No. You can start from your current level, whether or not you have sat the test before.' },
  { q: 'How do I pay?', a: 'By bank transfer, JazzCash or Easypaisa. Upload a clear photo or PDF of your receipt with the application.' },
  { q: 'How long does enrollment take?', a: 'After you upload your payment proof, the academy checks it, usually within one working day. Your portal opens as soon as it is confirmed.' },
  { q: 'What happens if my payment proof is not accepted?', a: 'You will see the reason in your application and can upload a corrected proof. Nothing is lost.' },
  { q: 'Are classes live?', a: 'Yes. Each batch has teacher-led classes on a fixed weekly timetable, plus mock tests and practice you complete in the portal.' },
];

export default async function HomePage() {
  const [course, batches] = await Promise.all([
    publicGet<PublicCourse>('/public/course', 120),
    publicGet<PublicBatch[]>('/public/batches', 120),
  ]);

  return (
    <div className="bg-canvas">
      <PublicHeader />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden pt-14 pb-20 sm:pb-28">
          <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[radial-gradient(60rem_28rem_at_50%_-10%,var(--primary-soft),transparent)]" />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="text-center lg:text-left">
              <p className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold tracking-wide text-primary uppercase">Complete IELTS preparation</p>
              <h1 className="mx-auto mt-6 max-w-xl font-display text-display text-fg lg:mx-0">
                Reach <span className="text-primary">your target band</span> with a teacher beside you.
              </h1>
              <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-fg-muted lg:mx-0">
                Join a live batch with teacher-led classes, regular mock tests and graded practice across Listening, Reading, Writing and Speaking.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                <a href="/register" className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-fg shadow-md transition-colors hover:bg-primary-hover">Join the next batch →</a>
                <a href="#course" className="inline-flex items-center justify-center rounded-full bg-surface px-6 py-3 text-sm font-semibold text-fg ring-1 ring-inset ring-border-strong transition-colors hover:bg-surface-muted">See what is included</a>
              </div>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                {TRUST_BADGES.map((b) => (
                  <span key={b.text} className="inline-flex items-center gap-2 rounded-full bg-surface px-3.5 py-1.5 text-sm font-medium text-fg ring-1 ring-border">
                    <b.icon aria-hidden className="size-4 text-primary" strokeWidth={1.75} />
                    {b.text}
                  </span>
                ))}
              </div>
              {course && (
                <dl className="mx-auto mt-10 grid max-w-lg grid-cols-3 gap-6 border-t border-border pt-6 text-sm lg:mx-0">
                  {course.durationWeeks ? <div><dt className="text-fg-subtle">Duration</dt><dd className="mt-1 text-xl font-bold text-fg">{course.durationWeeks} weeks</dd></div> : <div />}
                  <div><dt className="text-fg-subtle">Course fee</dt><dd className="mt-1 text-xl font-bold text-fg">{money(course.price, course.currency)}</dd></div>
                  <div><dt className="text-fg-subtle">Batch size</dt><dd className="mt-1 text-xl font-bold text-fg">No limit</dd></div>
                </dl>
              )}
            </div>

            {/* Floating dashboard mockup — illustrative, mirrors what the student portal shows */}
            <div className="relative mx-auto w-full max-w-sm lg:mx-0">
              <div aria-hidden className="absolute -right-4 -top-4 rounded-2xl bg-surface px-3 py-1.5 text-xs font-semibold text-accent-strong shadow-md ring-1 ring-border">
                <span className="inline-flex items-center gap-1"><TrendingUp className="size-3.5" strokeWidth={2} />Progress tracked weekly</span>
              </div>
              <div className="rounded-2xl bg-surface p-6 shadow-xl ring-1 ring-border">
                <p className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">Your dashboard · sample</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-canvas p-3 ring-1 ring-border"><p className="text-xs text-fg-subtle">Writing</p><p className="mt-1 text-lg font-bold text-fg">6.5</p></div>
                  <div className="rounded-lg bg-canvas p-3 ring-1 ring-border"><p className="text-xs text-fg-subtle">Speaking</p><p className="mt-1 text-lg font-bold text-fg">7.0</p></div>
                  <div className="rounded-lg bg-canvas p-3 ring-1 ring-border"><p className="text-xs text-fg-subtle">Reading</p><p className="mt-1 text-lg font-bold text-fg">7.5</p></div>
                  <div className="rounded-lg bg-canvas p-3 ring-1 ring-border"><p className="text-xs text-fg-subtle">Listening</p><p className="mt-1 text-lg font-bold text-fg">7.5</p></div>
                </div>
                <div className="mt-4 flex items-center justify-between rounded-lg bg-primary-soft px-4 py-3">
                  <span className="text-sm font-semibold text-primary">Estimated overall band</span>
                  <span className="font-display text-2xl font-bold text-primary">7.0</span>
                </div>
                <p className="mt-3 text-xs text-fg-subtle">Updated after every mock test and teacher-graded submission.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Stats strip */}
        <section className="border-y border-border bg-ink">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-10 sm:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <p className="font-display text-3xl font-bold text-white sm:text-4xl">{s.value}</p>
                <p className="mt-1 text-xs text-white/70 sm:text-sm">{s.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Feature showcase */}
        <section id="course" className="scroll-mt-20 py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-6">
            <div className="text-center">
              <h2 className="font-display text-h1 text-fg">Everything you need to raise your band — in one place</h2>
              <p className="mx-auto mt-3 max-w-xl text-base text-fg-muted">And the tools that keep you moving between classes.</p>
            </div>
            {course && (course.description || course.includes.length > 0) && (
              <div className="mx-auto mt-10 grid max-w-4xl gap-8 lg:grid-cols-[1fr_1.1fr]">
                {course.description && <p className="text-base leading-relaxed text-fg-muted">{course.description}</p>}
                {course.includes.length > 0 && (
                  <ul className="grid gap-x-8 gap-y-3 text-left sm:grid-cols-2">
                    {course.includes.map((i) => (
                      <li key={i} className="flex gap-3 text-sm leading-relaxed text-fg">
                        <CheckCircle2 aria-hidden className="mt-0.5 size-4.5 shrink-0 text-accent-strong" strokeWidth={2} />
                        <span>{i}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="mt-10">
              <FeatureShowcase />
            </div>
            <div className="mt-10 grid gap-5 sm:grid-cols-3">
              {TOOLS.map((t) => (
                <div key={t.title} className="rounded-lg bg-surface p-6 shadow-xs ring-1 ring-border">
                  <span aria-hidden className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent-strong">
                    <t.icon className="size-4.5" strokeWidth={1.75} />
                  </span>
                  <h3 className="mt-4 text-base font-bold text-fg">{t.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{t.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Batches */}
        <section id="batches" className="scroll-mt-20 border-y border-border bg-surface py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-6">
            <div className="mb-10 text-center">
              <p className="text-xs font-semibold tracking-wide text-primary uppercase">Batches</p>
              <h2 className="mt-2 font-display text-h1 text-fg">Upcoming batches</h2>
              <p className="mx-auto mt-3 max-w-xl text-base text-fg-muted">Every batch teaches the same complete course. Pick the schedule that fits your week.</p>
            </div>
            {batches === null ? (
              <Empty>We could not load the batches just now. Please refresh in a moment.</Empty>
            ) : batches.length === 0 ? (
              <Empty>No batch is open for enrollment right now. Please check back soon.</Empty>
            ) : (
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{batches.map((b) => <BatchCard key={b.id} batch={b} />)}</div>
            )}
          </div>
        </section>

        {/* How enrollment works */}
        <section id="how" className="scroll-mt-20 py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-6 text-center">
            <p className="text-xs font-semibold tracking-wide text-primary uppercase">How it works</p>
            <h2 className="mt-2 font-display text-h1 text-fg">From application to your first class — in five steps</h2>
            <ol className="mt-10 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-5">
              {STEPS.map((s, i) => {
                const Icon = [CalendarClock, UserCheck, Wallet, ScrollText, CalendarDays][i];
                return (
                  <li key={s.title} className="relative overflow-hidden rounded-lg bg-surface p-5 shadow-xs ring-1 ring-border">
                    <span aria-hidden className="pointer-events-none absolute -right-1 -top-3 text-5xl font-bold text-border">{i + 1}</span>
                    <span aria-hidden className="relative grid size-9 place-items-center rounded-full bg-primary text-primary-fg">
                      <Icon className="size-4" strokeWidth={1.75} />
                    </span>
                    <h3 className="relative mt-4 text-sm font-bold text-fg">{s.title}</h3>
                    <p className="relative mt-1.5 text-sm leading-relaxed text-fg-muted">{s.text}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* Reviews teaser */}
        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-6">
            <div className="mb-10 text-center">
              <p className="text-xs font-semibold tracking-wide text-primary uppercase">Student reviews</p>
              <h2 className="mt-2 font-display text-h1 text-fg">What students say.</h2>
              <p className="mx-auto mt-3 max-w-xl text-base text-fg-muted">A sample of the shape of feedback we collect. See real, named reviews as students opt in to share them.</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-3">
              {REVIEW_TEASER.map((r) => (
                <div key={r.quote} className="flex flex-col rounded-lg bg-surface p-6 shadow-xs ring-1 ring-border">
                  <div className="flex gap-0.5 text-amber-400">
                    {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="size-4" fill="currentColor" strokeWidth={0} />)}
                  </div>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-fg">&ldquo;{r.quote}&rdquo;</p>
                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
                    <span className="font-semibold text-fg-subtle italic">{r.name} · sample</span>
                    <span className="font-bold text-accent-strong">{r.band}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8 text-center">
              <a href="/reviews" className="text-sm font-semibold text-primary hover:underline">See all reviews →</a>
            </div>
          </div>
        </section>

        {/* Free tools teaser */}
        <section className="border-y border-border bg-surface py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-6">
            <div className="grid items-center gap-8 lg:grid-cols-[1fr_auto]">
              <div className="text-center lg:text-left">
                <p className="text-xs font-semibold tracking-wide text-primary uppercase">Free, no signup</p>
                <h2 className="mt-2 font-display text-h1 text-fg">Try the band score calculator.</h2>
                <p className="mx-auto mt-3 max-w-xl text-base text-fg-muted lg:mx-0">Convert your raw Listening and Reading scores to IELTS bands instantly — no account needed.</p>
              </div>
              <a href="/free-tools" className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-fg shadow-md transition-colors hover:bg-primary-hover">Open free tools →</a>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <p className="text-xs font-semibold tracking-wide text-primary uppercase">FAQ</p>
            <h2 className="mt-2 font-display text-h1 text-fg">Questions, answered.</h2>
          </div>
          <div className="mx-auto mt-8 max-w-3xl px-6 text-left">
            <FaqAccordion items={FAQ} />
          </div>
        </section>

        {/* Closing CTA */}
        <section className="px-6 py-16 sm:py-20">
          <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-6 rounded-2xl bg-ink px-8 py-12 text-ink-fg sm:flex-row sm:items-center sm:px-12">
            <div className="min-w-0">
              <h2 className="font-display text-h2 text-white">Ready to work toward your target band?</h2>
              <p className="mt-2 max-w-xl text-ink-fg/70">Choose a batch, register and start your first class.</p>
            </div>
            <a href="/register" className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white shadow-md transition-colors hover:bg-accent-strong">Enroll now</a>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
