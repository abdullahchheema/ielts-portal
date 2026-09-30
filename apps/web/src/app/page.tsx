import { BatchCard, PublicBatch } from '@/components/BatchCard';
import { PublicHeader } from '@/components/PublicHeader';
import { LinkButton } from '@/components/ui';
import { money } from '@/lib/format';
import { PublicCourse, publicGet } from '@/lib/server-api';

export const dynamic = 'force-dynamic'; // batches change often; never bake them into the build

const MODULES = [
  { name: 'Listening', text: 'Note completion, multiple choice, maps and diagrams — practised with timed tests.' },
  { name: 'Reading', text: 'Skimming, scanning and every question type, from True/False/Not Given to matching headings.' },
  { name: 'Writing', text: 'Task 1 and Task 2 essays graded by your teacher with clear, criteria-based feedback.' },
  { name: 'Speaking', text: 'Parts 1, 2 and 3 practice with recorded answers and personal feedback.' },
];

const STEPS = [
  { title: 'Choose a batch', text: 'Pick the start date and class timing that suit you.' },
  { title: 'Register', text: 'Tell us who you are and your current level.' },
  { title: 'Pay and upload proof', text: 'Pay by bank transfer, JazzCash or Easypaisa and attach your receipt.' },
  { title: 'We verify your payment', text: 'The academy checks it, usually within one working day.' },
  { title: 'Start learning', text: 'You are enrolled and your student portal opens.' },
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
        <section className="bg-gradient-to-b from-indigo-50 to-slate-50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
            <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-indigo-700">Complete IELTS Preparation</p>
            <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">One course. Four modules. A teacher with you every day.</h1>
            <p className="mt-4 max-w-2xl text-lg text-slate-600">Join a live IELTS batch with daily teacher-led classes, daily mock tests and past-paper practice, so you walk into the exam knowing exactly what to expect.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/register" className="px-6 py-3 text-base">Join the Next Batch</LinkButton>
              <LinkButton href="#course" variant="secondary" className="px-6 py-3 text-base">See what is included</LinkButton>
            </div>
            {course && <p className="mt-4 text-sm text-slate-500">{course.durationWeeks ? `${course.durationWeeks} weeks · ` : ''}{money(course.price, course.currency)} · no limit on batch size</p>}
          </div>
        </section>

        <section id="course" className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="mb-2 text-2xl font-semibold text-slate-900">Everything you need, in one course</h2>
          <p className="mb-8 max-w-2xl text-slate-600">{course?.description ?? 'A complete, teacher-led IELTS course covering Listening, Reading, Writing and Speaking.'}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map((m) => (
              <div key={m.name} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <h3 className="mb-1 font-semibold text-slate-900">{m.name}</h3>
                <p className="text-sm text-slate-600">{m.text}</p>
              </div>
            ))}
          </div>
          {course && (
            <ul className="mt-8 grid gap-x-8 gap-y-2 text-sm text-slate-700 sm:grid-cols-2">
              {course.includes.map((i) => <li key={i} className="flex gap-2"><span aria-hidden className="text-green-600">✓</span>{i}</li>)}
            </ul>
          )}
        </section>

        <section id="batches" className="bg-white py-14">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="mb-2 text-2xl font-semibold text-slate-900">Upcoming batches</h2>
            <p className="mb-8 text-slate-600">Every batch teaches the same complete course. Pick the schedule that fits your week.</p>
            {batches === null ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">We could not load the batches just now. Please refresh in a moment.</div>
            ) : batches.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No batch is open for enrollment right now. Please check back soon.</div>
            ) : (
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{batches.map((b) => <BatchCard key={b.id} batch={b} />)}</div>
            )}
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="mb-8 text-2xl font-semibold text-slate-900">How enrollment works</h2>
          <ol className="grid gap-4 md:grid-cols-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
                <span className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">{i + 1}</span>
                <h3 className="text-sm font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="bg-indigo-700">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-12 text-center">
            <h2 className="text-2xl font-semibold text-white">Ready for your target band?</h2>
            <LinkButton href="/register" variant="secondary" className="px-6 py-3 text-base">Enroll Now</LinkButton>
          </div>
        </section>
      </main>
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-sm text-slate-500">© {new Date().getFullYear()} IELTS Academy</footer>
    </>
  );
}
