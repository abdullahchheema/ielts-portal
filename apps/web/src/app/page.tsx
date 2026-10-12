import { CalendarClock, CalendarDays, CheckCircle2, ClipboardCheck, ScrollText, Target, TrendingUp, UserCheck, Users, Wallet } from 'lucide-react';
import { BatchCard, PublicBatch } from '@/components/BatchCard';
import { FaqAccordion, FeatureShowcase } from '@/components/MarketingInteractive';
import { PublicHeader } from '@/components/PublicHeader';
import { money } from '@/lib/format';
import { PublicCourse, publicGet } from '@/lib/server-api';

export const dynamic = 'force-dynamic'; // batches change often; never bake them into the build

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
    publicGet<PublicCourse>('/public/course'),
    publicGet<PublicBatch[]>('/public/batches'),
  ]);

  return (
    <div className="mkt">
      <PublicHeader />
      <main>
        {/* Hero */}
        <section className="pt-7 pb-16 sm:pb-22">
          <div className="mkt-container text-center">
            <p className="mkt-eyebrow">Complete IELTS preparation</p>
            <h1 className="mx-auto mt-5 max-w-3xl text-[2.5rem] leading-[1.08] sm:text-5xl lg:text-[3.3rem]">
              Designed to help you reach <span style={{ color: 'var(--mkt-blue)' }}>your target band</span> with a teacher beside you.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed sm:text-lg">
              Join a live batch with teacher-led classes, regular mock tests and graded practice across Listening, Reading, Writing and Speaking.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a href="/register" className="mkt-cta mkt-cta--gold">Join the next batch →</a>
              <a href="#course" className="mkt-cta mkt-cta--outline">See what is included</a>
            </div>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              {TRUST_BADGES.map((b) => (
                <span key={b.text} className="mkt-badge">
                  <b.icon aria-hidden className="size-4" style={{ color: 'var(--mkt-blue)' }} strokeWidth={1.75} />
                  {b.text}
                </span>
              ))}
            </div>
            {course && (
              <dl className="mx-auto mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-[var(--mkt-border)] pt-6 text-sm">
                {course.durationWeeks ? <div><dt className="text-[var(--mkt-subtle)]">Duration</dt><dd className="mt-1 text-xl font-extrabold">{course.durationWeeks} weeks</dd></div> : <div />}
                <div><dt className="text-[var(--mkt-subtle)]">Course fee</dt><dd className="mt-1 text-xl font-extrabold">{money(course.price, course.currency)}</dd></div>
                <div><dt className="text-[var(--mkt-subtle)]">Batch size</dt><dd className="mt-1 text-xl font-extrabold">No limit</dd></div>
              </dl>
            )}
          </div>
        </section>

        {/* Feature showcase */}
        <section id="course" className="mkt-section scroll-mt-20">
          <div className="mkt-container">
            <div className="text-center">
              <h2 className="text-3xl sm:text-4xl">Everything you need to raise your band — in one place</h2>
              <p className="mx-auto mt-3 max-w-xl text-base">And the tools that keep you moving between classes.</p>
            </div>
            {course && (course.description || course.includes.length > 0) && (
              <div className="mx-auto mt-10 grid max-w-4xl gap-8 lg:grid-cols-[1fr_1.1fr]">
                {course.description && <p className="text-base leading-relaxed">{course.description}</p>}
                {course.includes.length > 0 && (
                  <ul className="grid gap-x-8 gap-y-3 text-left sm:grid-cols-2">
                    {course.includes.map((i) => (
                      <li key={i} className="flex gap-3 text-sm leading-relaxed">
                        <CheckCircle2 aria-hidden className="mt-0.5 size-4.5 shrink-0" style={{ color: 'var(--mkt-blue)' }} strokeWidth={2} />
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
                <div key={t.title} className="mkt-card p-6">
                  <span aria-hidden className="grid size-10 place-items-center rounded-full text-white" style={{ background: 'var(--mkt-dark-grad)' }}>
                    <t.icon className="size-4.5" strokeWidth={1.75} />
                  </span>
                  <h3 className="mt-4 text-base font-extrabold">{t.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed">{t.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Batches */}
        <section id="batches" className="scroll-mt-20 py-16 sm:py-20" style={{ background: 'var(--mkt-surface)' }}>
          <div className="mkt-container">
            <div className="mb-10 text-center">
              <p className="mkt-eyebrow">Batches</p>
              <h2 className="mt-2 text-3xl sm:text-4xl">Upcoming batches</h2>
              <p className="mx-auto mt-3 max-w-xl text-base">Every batch teaches the same complete course. Pick the schedule that fits your week.</p>
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
        <section id="how" className="mkt-section scroll-mt-20">
          <div className="mkt-container text-center">
            <p className="mkt-eyebrow">How it works</p>
            <h2 className="mt-2 text-3xl sm:text-4xl">From application to your first class — in five steps</h2>
            <ol className="mt-10 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-5">
              {STEPS.map((s, i) => {
                const Icon = [CalendarClock, UserCheck, Wallet, ScrollText, CalendarDays][i];
                return (
                  <li key={s.title} className="mkt-card relative overflow-hidden p-5">
                    <span aria-hidden className="pointer-events-none absolute -right-1 -top-3 text-5xl font-extrabold text-[var(--mkt-border)]">{i + 1}</span>
                    <div className="relative flex items-center justify-between">
                      <span aria-hidden className="grid size-9 place-items-center rounded-full text-white" style={{ background: 'var(--mkt-blue-grad)' }}>
                        <Icon className="size-4" strokeWidth={1.75} />
                      </span>
                    </div>
                    <h3 className="relative mt-4 text-sm font-extrabold">{s.title}</h3>
                    <p className="relative mt-1.5 text-sm leading-relaxed">{s.text}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mkt-section scroll-mt-20" style={{ background: 'var(--mkt-surface)' }}>
          <div className="mx-auto max-w-3xl px-6 text-center">
            <p className="mkt-eyebrow">FAQ</p>
            <h2 className="mt-2 text-3xl sm:text-4xl">Questions, answered.</h2>
          </div>
          <div className="mx-auto mt-8 max-w-3xl px-6 text-left">
            <FaqAccordion items={FAQ} />
          </div>
        </section>

        {/* Closing CTA */}
        <section className="px-6 py-16 sm:py-20">
          <div
            className="mkt-container flex flex-col items-start justify-between gap-6 rounded-[24px] px-8 py-12 text-white sm:flex-row sm:items-center sm:px-12"
            style={{ background: 'var(--mkt-dark-grad)' }}
          >
            <div className="min-w-0">
              <h2 className="text-2xl text-white sm:text-3xl">Ready to work toward your target band?</h2>
              <p className="mt-2 max-w-xl text-slate-300">Choose a batch, register and start your first class.</p>
            </div>
            <a href="/register" className="mkt-cta mkt-cta--gold shrink-0">Enroll now</a>
          </div>
        </section>
      </main>

      <footer className="border-t" style={{ borderColor: 'var(--mkt-border)', background: 'var(--mkt-surface)' }}>
        <div className="mkt-container grid gap-10 py-14 sm:grid-cols-[1.3fr_1fr_1fr]">
          <div>
            <p className="text-base font-extrabold">IELTS Academy</p>
            <p className="mt-2 max-w-xs text-sm">Teacher-led IELTS preparation across all four modules.</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--mkt-subtle)]">Product</p>
            <nav className="mt-3 flex flex-col gap-2 text-sm">
              <a href="#course" className="hover:underline">Features</a>
              <a href="#how" className="hover:underline">How it works</a>
              <a href="#faq" className="hover:underline">FAQ</a>
            </nav>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--mkt-subtle)]">Account</p>
            <nav className="mt-3 flex flex-col gap-2 text-sm">
              <a href="/login" className="hover:underline">Log in</a>
              <a href="/register" className="hover:underline">Enroll now</a>
              <a href="/apply-teacher" className="hover:underline">Teach with us</a>
            </nav>
          </div>
        </div>
        <div className="border-t py-6 text-center text-xs text-[var(--mkt-subtle)]" style={{ borderColor: 'var(--mkt-border)' }}>
          © {new Date().getFullYear()} IELTS Academy
        </div>
      </footer>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="mkt-card rounded-2xl border-dashed px-6 py-10 text-center text-sm" style={{ background: 'var(--mkt-canvas)' }}>
      {children}
    </div>
  );
}
