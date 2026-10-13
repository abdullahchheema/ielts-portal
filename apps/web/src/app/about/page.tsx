import { BookOpen, GraduationCap, HeartHandshake, ShieldCheck } from 'lucide-react';
import { Reveal, Stagger, StaggerItem } from '@/components/motion/primitives';
import { PageHero } from '@/components/public/page-hero';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';

export const metadata = { title: 'About — Connect IELTS Academy' };

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
        <PageHero
          size="standard"
          eyebrow="About"
          title="Built by people who actually teach IELTS."
          subtitle="Connect IELTS Academy exists because most prep either costs too much for a cohort that needs weekly accountability, or is a pile of recorded videos nobody finishes. We built the thing in between: a live, teacher-led course with the practice tools to back it up."
        />

        <section className="border-y border-border bg-surface py-20 sm:py-24">
          <div className="mx-auto max-w-5xl px-5 sm:px-8">
            <Reveal>
              <h2 className="text-center font-display text-h1 text-fg">What we hold ourselves to</h2>
            </Reveal>
            <Stagger className="mt-12 grid gap-6 sm:grid-cols-2">
              {VALUES.map((v) => (
                <StaggerItem key={v.title} className="rounded-2xl bg-canvas p-7 shadow-sm ring-1 ring-border">
                  <span aria-hidden className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
                    <v.icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <h3 className="mt-5 text-base font-bold text-fg">{v.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-fg-muted">{v.text}</p>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        <section className="px-5 py-20 sm:px-8 sm:py-24">
          <Reveal className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-7 rounded-3xl bg-ink px-8 py-14 text-ink-fg sm:flex-row sm:items-center sm:px-14">
            <div className="min-w-0">
              <h2 className="font-display text-h2 text-white">Want to teach with us instead?</h2>
              <p className="mt-2 max-w-xl text-base text-ink-fg/70">We are always open to hearing from experienced IELTS teachers.</p>
            </div>
            <a href="/apply-teacher" className="inline-flex shrink-0 items-center justify-center rounded-xl bg-accent px-7 py-4 text-base font-bold text-accent-fg shadow-[var(--shadow-cta)] transition-[background-color,box-shadow,transform] duration-[--dur] ease-[--ease-out-soft] hover:bg-accent-hover hover:-translate-y-0.5">Apply to teach →</a>
          </Reveal>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
