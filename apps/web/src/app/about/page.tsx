import { BookOpen, GraduationCap, HeartHandshake, ShieldCheck } from 'lucide-react';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';

export const metadata = { title: 'About — IELTS Academy' };

const VALUES = [
  { icon: GraduationCap, title: 'Teachers, not just software', text: 'Every essay and speaking recording is graded by a person who knows the band descriptors, with AI as a second opinion — never the only one.' },
  { icon: ShieldCheck, title: 'Payments checked by a person', text: 'No automated billing you cannot question. A real member of the team verifies every payment proof before a seat is confirmed.' },
  { icon: BookOpen, title: 'One course, done properly', text: 'We do not split attention across a dozen products. One complete IELTS course, kept current, taught well.' },
  { icon: HeartHandshake, title: 'No seat limits, no pressure sell', text: 'Batches do not sell out to create urgency. We would rather you join when you are ready than rush a decision.' },
];

export default function AboutPage() {
  return (
    <div className="bg-canvas">
      <PublicHeader />
      <main>
        <section className="px-6 pt-14 pb-16 text-center sm:pb-20">
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">About</p>
          <h1 className="mx-auto mt-3 max-w-2xl font-display text-display text-fg">
            Built by people who actually teach IELTS.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-fg-muted">
            IELTS Academy exists because most prep either costs too much for a cohort that needs weekly accountability, or is a pile of recorded videos nobody finishes. We built the thing in between: a live, teacher-led course with the practice tools to back it up.
          </p>
        </section>

        <section className="border-y border-border bg-surface py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-6">
            <h2 className="text-center font-display text-h1 text-fg">What we hold ourselves to</h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2">
              {VALUES.map((v) => (
                <div key={v.title} className="rounded-lg bg-canvas p-6 shadow-xs ring-1 ring-border">
                  <span aria-hidden className="grid size-10 place-items-center rounded-full bg-primary-soft text-primary">
                    <v.icon className="size-4.5" strokeWidth={1.75} />
                  </span>
                  <h3 className="mt-4 text-base font-bold text-fg">{v.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{v.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 py-16 sm:py-20">
          <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-6 rounded-2xl bg-ink px-8 py-12 text-ink-fg sm:flex-row sm:items-center sm:px-12">
            <div className="min-w-0">
              <h2 className="font-display text-h2 text-white">Want to teach with us instead?</h2>
              <p className="mt-2 max-w-xl text-ink-fg/70">We are always open to hearing from experienced IELTS teachers.</p>
            </div>
            <a href="/apply-teacher" className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white shadow-md transition-colors hover:bg-accent-strong">Apply to teach →</a>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
