import { Award, CalendarDays, CheckCircle2, ClipboardCheck, GraduationCap, ScrollText, Star, Target, TrendingUp, UserCheck, Users } from 'lucide-react';
import { BatchCard, PublicBatch } from '@/components/BatchCard';
import { FaqAccordion, FeatureShowcase } from '@/components/MarketingInteractive';
import { CountUp, Reveal, Stagger, StaggerItem } from '@/components/motion/primitives';
import { PageHero } from '@/components/public/page-hero';
import { PortalPreview } from '@/components/PortalPreview';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';
import { TrustTicker } from '@/components/TrustTicker';
import { Empty } from '@/components/ui';
import { money } from '@/lib/format';
import { PublicCourse, publicGet } from '@/lib/server-api';

export const revalidate = 120; // batches change, but not every second — ISR beats force-dynamic

const TRUST_BADGES = [
  { icon: Users, text: 'Teacher-led classes, every week' },
  { icon: ClipboardCheck, text: 'All four modules, one course' },
];

/**
 * Headline stats for the hero strip. Placeholder figures — swap for verified numbers
 * (enrollment count, pass rate, average improvement) before this goes live.
 */
const STATS = [
  { value: 2500, suffix: '+', label: 'students coached' },
  { value: 94, suffix: '%', label: 'hit their target band' },
  { value: 1.8, suffix: '', label: 'bands average improvement', raw: '+1.8' },
  { value: 4.9, suffix: '/5', label: 'average student rating', raw: '4.9' },
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

// No payment steps here by design — that detail lives on /pricing. This is the top-of-funnel story.
const STEPS = [
  { title: 'Choose a batch', text: 'Pick the start date and class timing that suit your week.' },
  { title: 'Register', text: 'Tell us who you are and your current level.' },
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
  const [course, allBatches] = await Promise.all([
    publicGet<PublicCourse>('/public/course', 120),
    publicGet<PublicBatch[]>('/public/batches', 120),
  ]);
  // Only batches still taking new students belong on the homepage — a batch already underway or
  // in its verification window isn't something a new visitor can actually join today.
  const batches = allBatches?.filter((b) => b.status === 'OPEN') ?? allBatches;

  return (
    <div className="bg-canvas">
      <PublicHeader />
      <main>
        <PageHero
          size="full"
          align="split"
          eyebrow="Complete IELTS preparation"
          title={<>Reach <span className="text-primary">your target band</span> with a teacher beside you.</>}
          subtitle="Join a live batch with teacher-led classes, regular mock tests and graded practice across Listening, Reading, Writing and Speaking."
          primaryCta={{ label: 'Start preparing today →', href: '/register' }}
          secondaryCta={{ label: 'See what is included', href: '#course' }}
          trust={TRUST_BADGES.map((b) => (
            <span key={b.text} className="inline-flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-sm font-semibold text-fg shadow-xs ring-1 ring-border">
              <b.icon aria-hidden className="size-4 text-primary" strokeWidth={1.75} />
              {b.text}
            </span>
          ))}
          visual={
            <div className="relative mx-auto w-full max-w-sm animate-[float_7s_ease-in-out_infinite] motion-reduce:animate-none">
              <div aria-hidden className="absolute -right-4 -top-4 animate-[float-sm_5s_ease-in-out_infinite] rounded-2xl bg-surface px-3.5 py-2 text-xs font-bold text-accent-strong shadow-md ring-1 ring-border motion-reduce:animate-none">
                <span className="inline-flex items-center gap-1.5"><TrendingUp className="size-4" strokeWidth={2} />Progress tracked weekly</span>
              </div>
              <div className="rounded-3xl bg-surface p-7 shadow-xl ring-1 ring-border">
                <p className="text-overline font-bold uppercase text-fg-subtle">Your dashboard · sample</p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-canvas p-4 ring-1 ring-border"><p className="text-xs font-semibold text-fg-subtle">Writing</p><p className="mt-1 text-xl font-bold text-fg">6.5</p></div>
                  <div className="rounded-xl bg-canvas p-4 ring-1 ring-border"><p className="text-xs font-semibold text-fg-subtle">Speaking</p><p className="mt-1 text-xl font-bold text-fg">7.0</p></div>
                  <div className="rounded-xl bg-canvas p-4 ring-1 ring-border"><p className="text-xs font-semibold text-fg-subtle">Reading</p><p className="mt-1 text-xl font-bold text-fg">7.5</p></div>
                  <div className="rounded-xl bg-canvas p-4 ring-1 ring-border"><p className="text-xs font-semibold text-fg-subtle">Listening</p><p className="mt-1 text-xl font-bold text-fg">7.5</p></div>
                </div>
                <div className="mt-4 flex items-center justify-between rounded-xl bg-primary-soft px-5 py-4">
                  <span className="text-sm font-bold text-primary">Estimated overall band</span>
                  <span className="font-display text-2xl font-extrabold text-primary">7.0</span>
                </div>
                <p className="mt-4 text-xs text-fg-subtle">Updated after every mock test and teacher-graded submission.</p>
              </div>
            </div>
          }
        >
          {course && (
            <dl className="mt-10 grid max-w-lg grid-cols-2 gap-6 border-t border-border pt-7 text-sm">
              {course.durationWeeks ? <div><dt className="text-fg-subtle">Duration</dt><dd className="mt-1 text-xl font-bold text-fg">{course.durationWeeks} weeks</dd></div> : <div />}
              <div><dt className="text-fg-subtle">Batch size</dt><dd className="mt-1 text-xl font-bold text-fg">No limit</dd></div>
            </dl>
          )}
        </PageHero>

        <TrustTicker />

        {/* Stats strip */}
        <section className="border-y border-border bg-ink">
          <Stagger className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-5 py-12 sm:px-8 sm:grid-cols-4">
            {STATS.map((s) => (
              <StaggerItem key={s.label} className="text-center">
                <p className="font-display text-3xl font-extrabold text-white sm:text-4xl">
                  {s.raw ?? <CountUp value={s.value} suffix={s.suffix} />}
                </p>
                <p className="mt-1.5 text-sm text-white/70">{s.label}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* Feature showcase */}
        <section id="course" className="scroll-mt-20 py-20 sm:py-24">
          <div className="mx-auto max-w-5xl px-5 sm:px-8">
            <Reveal className="text-center">
              <h2 className="font-display text-h1 text-fg">Everything you need to raise your band — in one place</h2>
              <p className="mx-auto mt-3 max-w-xl text-lead text-fg-muted">And the tools that keep you moving between classes.</p>
            </Reveal>
            {course && (course.description || course.includes.length > 0) && (
              <Reveal className="mx-auto mt-12 grid max-w-4xl gap-8 lg:grid-cols-[1fr_1.1fr]">
                {course.description && <p className="text-base leading-relaxed text-fg-muted">{course.description}</p>}
                {course.includes.length > 0 && (
                  <ul className="grid gap-x-8 gap-y-3.5 text-left sm:grid-cols-2">
                    {course.includes.map((i) => (
                      <li key={i} className="flex gap-3 text-sm leading-relaxed text-fg">
                        <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-accent-strong" strokeWidth={2} />
                        <span>{i}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Reveal>
            )}
            <Reveal className="mt-12">
              <FeatureShowcase />
            </Reveal>
            <Stagger className="mt-12 grid gap-6 sm:grid-cols-3">
              {TOOLS.map((t, i) => (
                <StaggerItem key={t.title} className="rounded-2xl bg-surface p-7 shadow-sm ring-1 ring-border transition-[box-shadow,transform] duration-[--dur] ease-[--ease-out-soft] hover:shadow-lg hover:-translate-y-0.5">
                  <span
                    aria-hidden
                    className="grid size-11 animate-[float-sm_4.5s_ease-in-out_infinite] place-items-center rounded-xl bg-accent-soft text-accent-strong motion-reduce:animate-none"
                    style={{ animationDelay: `${i * 0.4}s` }}
                  >
                    <t.icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <h3 className="mt-5 text-base font-bold text-fg">{t.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-fg-muted">{t.text}</p>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        {/* Portal preview */}
        <section className="scroll-mt-20 border-y border-border bg-surface py-20 sm:py-24">
          <div className="mx-auto max-w-5xl px-5 sm:px-8">
            <Reveal className="mb-12 text-center">
              <p className="text-overline font-bold text-primary uppercase">Inside the portal</p>
              <h2 className="mt-2 font-display text-h1 text-fg">What your student portal actually looks like.</h2>
              <p className="mx-auto mt-3 max-w-xl text-lead text-fg-muted">A live preview of the dashboard, mock tests, writing feedback and speaking practice — not screenshots from someone else's product.</p>
            </Reveal>
            <Reveal>
              <PortalPreview />
            </Reveal>
          </div>
        </section>

        {/* Teachers */}
        <section className="py-20 sm:py-24">
          <Reveal className="mx-auto max-w-5xl px-5 sm:px-8">
            <div className="flex flex-col items-center gap-8 rounded-3xl bg-primary-soft p-10 text-center sm:p-14">
              <span aria-hidden className="grid size-16 animate-[float_6s_ease-in-out_infinite] place-items-center rounded-2xl bg-primary text-primary-fg shadow-md motion-reduce:animate-none">
                <GraduationCap className="size-8" strokeWidth={1.75} />
              </span>
              <div className="max-w-2xl">
                <h2 className="font-display text-h1 text-fg">Taught by experienced, hands-on IELTS teachers.</h2>
                <p className="mx-auto mt-4 text-lead leading-relaxed text-fg-muted">Every class is led by a professional teacher with real, hands-on IELTS coaching experience — not a recorded video. They grade your work personally, sit in on your progress, and adjust what you practice next.</p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-sm font-semibold text-fg shadow-xs ring-1 ring-border"><Award className="size-4 text-primary" strokeWidth={1.75} />Hands-on IELTS coaching experience</span>
                <span className="inline-flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-sm font-semibold text-fg shadow-xs ring-1 ring-border"><Users className="size-4 text-primary" strokeWidth={1.75} />Every submission graded by a person</span>
              </div>
            </div>
          </Reveal>
        </section>

        {/* Batches */}
        <section id="batches" className="scroll-mt-20 border-y border-border bg-surface py-20 sm:py-24">
          <div className="mx-auto max-w-5xl px-5 sm:px-8">
            <Reveal className="mb-12 text-center">
              <p className="text-overline font-bold text-primary uppercase">Batches</p>
              <h2 className="mt-2 font-display text-h1 text-fg">Upcoming batches</h2>
              <p className="mx-auto mt-3 max-w-xl text-lead text-fg-muted">Every batch teaches the same complete course. Pick the schedule that fits your week.</p>
            </Reveal>
            {batches === null ? (
              <Empty>We could not load the batches just now. Please refresh in a moment.</Empty>
            ) : batches.length === 0 ? (
              <Empty>No batch is open for enrollment right now. Please check back soon.</Empty>
            ) : (
              <Stagger className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{batches.map((b) => <StaggerItem key={b.id}><BatchCard batch={b} /></StaggerItem>)}</Stagger>
            )}
          </div>
        </section>

        {/* How enrollment works */}
        <section id="how" className="scroll-mt-20 py-20 sm:py-24">
          <div className="mx-auto max-w-5xl px-5 text-center sm:px-8">
            <Reveal>
              <p className="text-overline font-bold text-primary uppercase">How it works</p>
              <h2 className="mt-2 font-display text-h1 text-fg">From application to your first class — in three steps</h2>
            </Reveal>
            <Stagger className="mt-12 grid gap-5 text-left sm:grid-cols-3">
              {STEPS.map((s, i) => {
                const Icon = [UserCheck, ClipboardCheck, CalendarDays][i];
                return (
                  <StaggerItem key={s.title} className="rounded-2xl bg-surface p-6 shadow-sm ring-1 ring-border">
                    <div className="flex items-start justify-between gap-3">
                      <span aria-hidden className="grid size-11 place-items-center rounded-xl bg-primary text-primary-fg">
                        <Icon className="size-5" strokeWidth={1.75} />
                      </span>
                      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">{i + 1}</span>
                    </div>
                    <h3 className="mt-5 text-base font-bold text-fg">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-fg-muted">{s.text}</p>
                  </StaggerItem>
                );
              })}
            </Stagger>
          </div>
        </section>

        {/* Reviews teaser */}
        <section className="py-20 sm:py-24">
          <div className="mx-auto max-w-5xl px-5 sm:px-8">
            <Reveal className="mb-12 text-center">
              <p className="text-overline font-bold text-primary uppercase">Student reviews</p>
              <h2 className="mt-2 font-display text-h1 text-fg">What students say.</h2>
              <p className="mx-auto mt-3 max-w-xl text-lead text-fg-muted">A sample of the shape of feedback we collect. See real, named reviews as students opt in to share them.</p>
            </Reveal>
            <Stagger className="grid gap-6 sm:grid-cols-3">
              {REVIEW_TEASER.map((r) => (
                <StaggerItem key={r.quote} className="flex flex-col rounded-2xl bg-surface p-7 shadow-sm ring-1 ring-border">
                  <div className="flex gap-0.5 text-amber-400">
                    {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="size-4" fill="currentColor" strokeWidth={0} />)}
                  </div>
                  <p className="mt-4 flex-1 text-sm leading-relaxed text-fg">&ldquo;{r.quote}&rdquo;</p>
                  <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs">
                    <span className="font-semibold text-fg-subtle italic">{r.name} · sample</span>
                    <span className="font-bold text-accent-strong">{r.band}</span>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
            <div className="mt-10 text-center">
              <a href="/reviews" className="text-sm font-bold text-primary hover:underline">See all reviews →</a>
            </div>
          </div>
        </section>

        {/* Free tools teaser */}
        <section className="border-y border-border bg-surface py-20 sm:py-24">
          <Reveal className="mx-auto max-w-5xl px-5 sm:px-8">
            <div className="grid items-center gap-8 lg:grid-cols-[1fr_auto]">
              <div className="text-center lg:text-left">
                <p className="text-overline font-bold text-primary uppercase">Free, no signup</p>
                <h2 className="mt-2 font-display text-h1 text-fg">Try the band score calculator.</h2>
                <p className="mx-auto mt-3 max-w-xl text-lead text-fg-muted lg:mx-0">Convert your raw Listening and Reading scores to IELTS bands instantly — no account needed.</p>
              </div>
              <a href="/free-tools" className="inline-flex shrink-0 items-center justify-center rounded-xl bg-primary px-7 py-4 text-base font-bold text-primary-fg shadow-sm transition-[background-color,box-shadow,transform] duration-[--dur] ease-[--ease-out-soft] hover:bg-primary-hover hover:shadow-md hover:-translate-y-0.5">Open free tools →</a>
            </div>
          </Reveal>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 py-20 sm:py-24">
          <Reveal className="mx-auto max-w-3xl px-5 text-center sm:px-8">
            <p className="text-overline font-bold text-primary uppercase">FAQ</p>
            <h2 className="mt-2 font-display text-h1 text-fg">Questions, answered.</h2>
          </Reveal>
          <Reveal className="mx-auto mt-10 max-w-3xl px-5 text-left sm:px-8">
            <FaqAccordion items={FAQ} />
          </Reveal>
        </section>

        {/* Closing CTA */}
        <section className="px-5 py-20 sm:px-8 sm:py-24">
          <Reveal className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-7 rounded-3xl bg-ink px-8 py-14 text-ink-fg sm:flex-row sm:items-center sm:px-14">
            <div className="min-w-0">
              <h2 className="font-display text-h2 text-white">Ready to work toward your target band?</h2>
              <p className="mt-2 max-w-xl text-base text-ink-fg/70">Choose a batch, register and start your first class.</p>
            </div>
            <a href="/register" className="inline-flex shrink-0 items-center justify-center rounded-xl bg-accent px-8 py-4 text-lead font-bold text-accent-fg shadow-[var(--shadow-cta)] transition-[background-color,box-shadow,transform] duration-[--dur] ease-[--ease-out-soft] hover:bg-accent-hover hover:-translate-y-0.5">Enroll now →</a>
          </Reveal>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
