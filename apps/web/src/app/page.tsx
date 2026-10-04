import { BookOpen, CalendarClock, CheckCircle2, ChevronDown, Headphones, Mic, PenLine, ScrollText, UserCheck, Wallet } from 'lucide-react';
import { BatchCard, PublicBatch } from '@/components/BatchCard';
import { PublicHeader } from '@/components/PublicHeader';
import { LinkButton } from '@/components/ui';
import { money } from '@/lib/format';
import { PublicCourse, publicGet } from '@/lib/server-api';

export const dynamic = 'force-dynamic'; // batches change often; never bake them into the build

// Module copy describes what the course teaches. It makes no claims about results.
const MODULES = [
  { name: 'Listening', icon: Headphones, text: 'Note completion, multiple choice, maps and diagrams, practised under timed conditions.' },
  { name: 'Reading', icon: BookOpen, text: 'Skimming, scanning and every question type, from True/False/Not Given to matching headings.' },
  { name: 'Writing', icon: PenLine, text: 'Task 1 and Task 2 essays graded by your teacher, with criteria-based feedback.' },
  { name: 'Speaking', icon: Mic, text: 'Parts 1, 2 and 3 practice, with recorded answers and personal feedback.' },
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
    <>
      <PublicHeader />
      <main>
        {/* Hero */}
        <section className="relative isolate overflow-hidden border-b border-border bg-surface">
          <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_85%_-10%,var(--primary-soft),transparent)]" />
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center lg:gap-16">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold tracking-wide text-primary ring-1 ring-inset ring-primary/15">
                Complete IELTS preparation
              </p>
              <h1 className="mt-5 font-display text-4xl font-semibold leading-[1.08] tracking-tight text-fg sm:text-5xl lg:text-[3.4rem]">
                One course, all four modules, and a teacher with you every day.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-fg-muted">
                Join a live IELTS batch with teacher-led classes, regular mock tests and past-paper practice. You will know exactly what the exam expects before you sit it.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <LinkButton href="/register" size="lg">Join the next batch</LinkButton>
                <LinkButton href="#course" variant="secondary" size="lg">See what is included</LinkButton>
              </div>
              {course && (
                <dl className="mt-10 grid max-w-lg grid-cols-3 gap-6 border-t border-border pt-6 text-sm">
                  {course.durationWeeks ? <div><dt className="text-fg-muted">Duration</dt><dd className="mt-1 font-display text-xl font-semibold text-fg">{course.durationWeeks} weeks</dd></div> : null}
                  <div><dt className="text-fg-muted">Course fee</dt><dd className="mt-1 font-display text-xl font-semibold text-fg">{money(course.price, course.currency)}</dd></div>
                  <div><dt className="text-fg-muted">Batch size</dt><dd className="mt-1 font-display text-xl font-semibold text-fg">No limit</dd></div>
                </dl>
              )}
            </div>

            {/* Four modules at a glance */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              {MODULES.map((m) => (
                <div key={m.name} className="rounded-lg bg-canvas p-5 ring-1 ring-border">
                  <span className="grid size-9 place-items-center rounded-md bg-primary text-primary-fg"><m.icon aria-hidden className="size-4.5" strokeWidth={1.75} /></span>
                  <p className="mt-4 font-display text-base font-semibold text-fg">{m.name}</p>
                  <p className="mt-1 text-sm text-fg-muted">Included in your course.</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* What is included */}
        <section id="course" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
            <div className="min-w-0">
              <h2 className="font-display text-3xl font-semibold tracking-tight text-fg">Everything you need, in one course</h2>
              <p className="mt-4 text-base leading-relaxed text-fg-muted">
                {course?.description ?? 'A complete, teacher-led IELTS course covering Listening, Reading, Writing and Speaking.'}
              </p>
            </div>
            {course && course.includes.length > 0 && (
              <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                {course.includes.map((i) => (
                  <li key={i} className="flex gap-3 text-sm leading-relaxed text-fg">
                    <CheckCircle2 aria-hidden className="mt-0.5 size-4.5 shrink-0 text-accent-strong" strokeWidth={2} />
                    <span>{i}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Batches */}
        <section id="batches" className="scroll-mt-20 border-y border-border bg-surface py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-3xl font-semibold tracking-tight text-fg">Upcoming batches</h2>
                <p className="mt-3 max-w-2xl text-base text-fg-muted">Every batch teaches the same complete course. Pick the schedule that fits your week.</p>
              </div>
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
        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="font-display text-3xl font-semibold tracking-tight text-fg">How enrollment works</h2>
          <p className="mt-3 max-w-2xl text-base text-fg-muted">Five steps from choosing a batch to your first lesson.</p>
          <ol className="mt-10 grid gap-4 md:grid-cols-5">
            {STEPS.map((s, i) => {
              const Icon = [CalendarClock, UserCheck, Wallet, ScrollText, BookOpen][i];
              return (
                <li key={s.title} className="relative rounded-lg bg-surface p-5 ring-1 ring-border">
                  <div className="flex items-center justify-between">
                    <span className="grid size-8 place-items-center rounded-full bg-primary-soft font-display text-sm font-semibold text-primary tabular-nums">{i + 1}</span>
                    <Icon aria-hidden className="size-4 text-fg-subtle" strokeWidth={1.75} />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-fg">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{s.text}</p>
                </li>
              );
            })}
          </ol>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 pb-16 sm:px-6 sm:pb-20">
          <h2 className="font-display text-3xl font-semibold tracking-tight text-fg">Questions students ask</h2>
          <div className="mt-8 divide-y divide-border overflow-hidden rounded-lg bg-surface ring-1 ring-border">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-5 py-4 open:bg-canvas">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-medium text-fg marker:hidden focus-visible:outline-2 focus-visible:outline-ring">
                  {f.q}
                  <ChevronDown aria-hidden className="size-4.5 shrink-0 text-fg-muted transition-transform duration-200 group-open:rotate-180" />
                </summary>
                <p className="mt-3 pr-8 text-sm leading-relaxed text-fg-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Closing CTA */}
        <section className="px-4 pb-16 sm:px-6 sm:pb-24">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 rounded-lg bg-navy-900 px-8 py-12 text-white sm:flex-row sm:items-center sm:px-12">
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Ready to work toward your target band?</h2>
              <p className="mt-2 max-w-xl text-slate-300">Choose a batch, register and start your first class.</p>
            </div>
            <LinkButton href="/register" variant="secondary" size="lg">Enroll now</LinkButton>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="font-display font-semibold text-fg">IELTS Academy</p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            <a href="#course" className="hover:text-fg">The course</a>
            <a href="#batches" className="hover:text-fg">Batches</a>
            <a href="#faq" className="hover:text-fg">FAQ</a>
            <a href="/apply-teacher" className="hover:text-fg">Teach with us</a>
            <a href="/login" className="hover:text-fg">Log in</a>
          </nav>
          <p>© {new Date().getFullYear()} IELTS Academy</p>
        </div>
      </footer>
    </>
  );
}

// Local to this page: the shared Empty is for portal lists, not marketing sections.
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-border-strong bg-canvas px-6 py-10 text-center text-sm text-fg-muted">{children}</div>;
}
