import { CalendarCheck, ClipboardList, Headphones, Mic, PenLine, Target, type LucideIcon } from 'lucide-react';
import { CurriculumExplorer } from '@/components/CurriculumExplorer';
import { Reveal, Stagger, StaggerItem } from '@/components/motion/primitives';
import { PageHero } from '@/components/public/page-hero';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';
import { PublicCourse, publicGet } from '@/lib/server-api';

export const revalidate = 120;
export const metadata = { title: 'Course outline & roadmap — Connect IELTS Academy' };

const ROADMAP: { week: string; title: string; icon: LucideIcon; text: string }[] = [
  { week: 'Week 1', title: 'Diagnostic & orientation', icon: Target, text: 'A full diagnostic mock across all four modules to find your starting band and your weakest skill, plus an orientation to how the band descriptors actually score your work.' },
  { week: 'Week 2', title: 'Listening & Reading foundations', icon: Headphones, text: 'Every question type for both modules — note completion, matching, True/False/Not Given — with timed drills on the ones you missed in your diagnostic.' },
  { week: 'Week 3', title: 'Writing Task 1', icon: PenLine, text: 'Academic: describing graphs, charts and diagrams. General Training: formal and informal letters. Structure, cohesion and the exact language examiners look for.' },
  { week: 'Week 4', title: 'Speaking Parts 1 & 2', icon: Mic, text: 'Recorded practice on everyday topics and timed Part 2 cue cards, with teacher feedback on fluency, pacing and pronunciation.' },
  { week: 'Week 5', title: 'Writing Task 2', icon: ClipboardList, text: 'The 250-word argumentative essay — building a position, developing it with examples, and the grammar range that moves you up a band.' },
  { week: 'Week 6', title: 'Listening & Reading, advanced', icon: Headphones, text: 'Harder question types and full-length timed sections, now under real exam pressure instead of split drills.' },
  { week: 'Week 7', title: 'Full mock test', icon: CalendarCheck, text: 'A complete, timed mock across all four modules plus a mock speaking interview, with a full band breakdown against the official descriptors.' },
  { week: 'Week 8', title: 'Final polish & exam strategy', icon: Target, text: 'Targeted drilling on whatever is still holding your band back, a second full mock, and exam-day pacing and strategy.' },
];

export default async function CurriculumPage() {
  const course = await publicGet<PublicCourse>('/public/course', 120);
  const weeks = course?.durationWeeks ?? ROADMAP.length;

  return (
    <div className="bg-canvas">
      <PublicHeader />
      <main>
        <PageHero
          size="standard"
          eyebrow="Course outline"
          title="Your roadmap, module by module."
          subtitle="Exactly what's covered for Academic and General Training, and the week-by-week path from diagnostic to exam-ready."
          primaryCta={{ label: 'Start preparing today →', href: '/register' }}
          secondaryCta={{ label: 'See pricing', href: '/pricing' }}
        />

        <section className="px-5 pt-6 pb-20 sm:px-8 sm:pt-8 sm:pb-24">
          <div className="mx-auto max-w-5xl">
            <Reveal className="mb-10 text-center">
              <p className="text-overline font-bold text-primary uppercase">Modules</p>
              <h2 className="mt-2 font-display text-h1 text-fg">What's covered in each skill.</h2>
            </Reveal>
            <Reveal>
              <CurriculumExplorer />
            </Reveal>
          </div>
        </section>

        <section className="border-y border-border bg-surface px-5 py-20 sm:px-8 sm:py-24">
          <div className="mx-auto max-w-5xl">
            <Reveal className="mb-12 text-center">
              <p className="text-overline font-bold text-primary uppercase">The pathway</p>
              <h2 className="mt-2 font-display text-h1 text-fg">An {weeks}-week path from diagnostic to exam-ready.</h2>
              <p className="mx-auto mt-3 max-w-xl text-lead text-fg-muted">Every batch follows this structure. Your teacher adjusts the pace to where your diagnostic shows you actually need the work.</p>
            </Reveal>
            <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {ROADMAP.map((r) => (
                <StaggerItem key={r.week} className="rounded-2xl bg-canvas p-6 shadow-sm ring-1 ring-border">
                  <span aria-hidden className="grid size-11 place-items-center rounded-xl bg-primary text-primary-fg">
                    <r.icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <p className="mt-5 text-xs font-bold tracking-wide text-accent-strong uppercase">{r.week}</p>
                  <h3 className="mt-1 text-base font-bold text-fg">{r.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-fg-muted">{r.text}</p>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        <section className="px-5 py-20 sm:px-8 sm:py-24">
          <Reveal className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-7 rounded-3xl bg-ink px-8 py-14 text-ink-fg sm:flex-row sm:items-center sm:px-14">
            <div className="min-w-0">
              <h2 className="font-display text-h2 text-white">Ready to start week one?</h2>
              <p className="mt-2 max-w-xl text-base text-ink-fg/70">Choose a batch, register and start your diagnostic.</p>
            </div>
            <a href="/register" className="inline-flex shrink-0 items-center justify-center rounded-xl bg-accent px-8 py-4 text-lead font-bold text-accent-fg shadow-[var(--shadow-cta)] transition-[background-color,box-shadow,transform] duration-[--dur] ease-[--ease-out-soft] hover:bg-accent-hover hover:-translate-y-0.5">Enroll now →</a>
          </Reveal>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
