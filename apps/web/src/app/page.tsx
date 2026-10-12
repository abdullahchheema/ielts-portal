import { CalendarClock, CalendarDays, CheckCircle2, ClipboardCheck, ScrollText, Target, TrendingUp, UserCheck, Users, Wallet } from 'lucide-react';
import { BatchCard, PublicBatch } from '@/components/BatchCard';
import { FaqAccordion, FeatureShowcase } from '@/components/MarketingInteractive';
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

// Real features we have built, not a marketing wishlist.
const TOOLS = [
  { icon: Target, title: 'Personalized study plan', text: 'Built from your practice and your weakest skills, and updated as you go.' },
  { icon: ScrollText, title: 'Full mock tests', text: 'Timed, all four modules, with an estimated band at the end.' },
  { icon: TrendingUp, title: 'Progress you can see', text: 'A readiness estimate and a skill-by-skill history, not just a single score.' },
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
          <div className="mx-auto max-w-5xl px-6 text-center">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold tracking-wide text-primary uppercase">Complete IELTS preparation</p>
            <h1 className="mx-auto mt-6 max-w-3xl font-display text-display text-fg">
              Reach <span className="text-primary">your target band</span> with a teacher beside you.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-fg-muted">
              Join a live batch with teacher-led classes, regular mock tests and graded practice across Listening, Reading, Writing and Speaking.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a href="/register" className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-fg shadow-md transition-colors hover:bg-primary-hover">Join the next batch →</a>
              <a href="#course" className="inline-flex items-center justify-center rounded-full bg-surface px-6 py-3 text-sm font-semibold text-fg ring-1 ring-inset ring-border-strong transition-colors hover:bg-surface-muted">See what is included</a>
            </div>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              {TRUST_BADGES.map((b) => (
                <span key={b.text} className="inline-flex items-center gap-2 rounded-full bg-surface px-3.5 py-1.5 text-sm font-medium text-fg ring-1 ring-border">
                  <b.icon aria-hidden className="size-4 text-primary" strokeWidth={1.75} />
                  {b.text}
                </span>
              ))}
            </div>
            {course && (
              <dl className="mx-auto mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-border pt-6 text-sm">
                {course.durationWeeks ? <div><dt className="text-fg-subtle">Duration</dt><dd className="mt-1 text-xl font-bold text-fg">{course.durationWeeks} weeks</dd></div> : <div />}
                <div><dt className="text-fg-subtle">Course fee</dt><dd className="mt-1 text-xl font-bold text-fg">{money(course.price, course.currency)}</dd></div>
                <div><dt className="text-fg-subtle">Batch size</dt><dd className="mt-1 text-xl font-bold text-fg">No limit</dd></div>
              </dl>
            )}
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

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 border-t border-border bg-surface py-16 sm:py-20">
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

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto grid max-w-5xl gap-10 px-6 py-14 sm:grid-cols-[1.3fr_1fr_1fr]">
          <div>
            <p className="text-base font-bold text-fg">IELTS Academy</p>
            <p className="mt-2 max-w-xs text-sm text-fg-muted">Teacher-led IELTS preparation across all four modules.</p>
          </div>
          <div>
            <p className="text-xs font-bold tracking-wide text-fg-subtle uppercase">Product</p>
            <nav className="mt-3 flex flex-col gap-2 text-sm text-fg-muted">
              <a href="#course" className="hover:text-fg hover:underline">Features</a>
              <a href="#how" className="hover:text-fg hover:underline">How it works</a>
              <a href="#faq" className="hover:text-fg hover:underline">FAQ</a>
            </nav>
          </div>
          <div>
            <p className="text-xs font-bold tracking-wide text-fg-subtle uppercase">Account</p>
            <nav className="mt-3 flex flex-col gap-2 text-sm text-fg-muted">
              <a href="/login" className="hover:text-fg hover:underline">Log in</a>
              <a href="/register" className="hover:text-fg hover:underline">Enroll now</a>
              <a href="/apply-teacher" className="hover:text-fg hover:underline">Teach with us</a>
            </nav>
          </div>
        </div>
        <div className="border-t border-border py-6 text-center text-xs text-fg-subtle">
          © {new Date().getFullYear()} IELTS Academy
        </div>
      </footer>
    </div>
  );
}
