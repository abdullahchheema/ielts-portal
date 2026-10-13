import { CheckCircle2, Clock, CreditCard, ShieldCheck } from 'lucide-react';
import { FaqAccordion } from '@/components/MarketingInteractive';
import { Reveal } from '@/components/motion/primitives';
import { PageHero } from '@/components/public/page-hero';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';
import { money } from '@/lib/format';
import { PublicCourse, publicGet } from '@/lib/server-api';

export const revalidate = 120;
export const metadata = { title: 'Pricing — Connect IELTS Academy' };

const PAYMENT_METHODS = ['Bank transfer', 'JazzCash', 'Easypaisa'];

const PRICING_FAQ = [
  { q: 'Is this a subscription?', a: 'No. One payment covers the full course and your access window. There is no recurring charge.' },
  { q: 'How do I pay?', a: `By ${PAYMENT_METHODS.join(', ')}, or another method you arrange with us. Upload a clear photo or PDF of your receipt with your application.` },
  { q: 'How fast is payment verified?', a: 'A real person on our team checks every payment proof, usually within one working day. Your portal opens as soon as it is confirmed.' },
  { q: 'What if my proof is rejected?', a: 'You will see the reason directly in your application and can upload a corrected proof — nothing is lost and you do not need to start over.' },
  { q: 'Is there a batch size limit?', a: 'No. Batches are not capped, so a seat is never "sold out" — only the start date and class timing differ between batches.' },
];

export default async function PricingPage() {
  const course = await publicGet<PublicCourse>('/public/course', 120);

  return (
    <div className="bg-canvas">
      <PublicHeader />
      <main>
        <PageHero
          size="standard"
          eyebrow="Pricing"
          title="One course. One price. No tiers to compare."
          subtitle="We do not split Listening, Reading, Writing and Speaking into separate paid plans. Every student gets the complete course."
        />

        <Reveal as="section" className="px-5 pt-6 pb-20 sm:px-8 sm:pt-8 sm:pb-24">
          <div className="mx-auto max-w-2xl overflow-hidden rounded-3xl bg-surface shadow-xl ring-1 ring-border">
            <div className="bg-ink px-8 py-10 text-center text-white">
              <p className="text-overline font-bold uppercase text-white/70">{course?.title ?? 'Complete IELTS Preparation'}</p>
              <p className="mt-4 font-display text-5xl font-extrabold">{course ? money(course.price, course.currency) : '—'}</p>
              <p className="mt-2 text-sm text-white/70">one-time, full access{course?.durationWeeks ? ` for ${course.durationWeeks} weeks` : ''}</p>
            </div>
            <div className="p-8 sm:p-9">
              {course?.description && <p className="text-base leading-relaxed text-fg-muted">{course.description}</p>}
              <ul className="mt-7 space-y-3.5">
                {(course?.includes?.length ? course.includes : [
                  'Teacher-led classes every week',
                  'All four modules: Listening, Reading, Writing, Speaking',
                  'Full mock tests with an estimated band',
                  'Personalized study plan',
                  'Progress dashboard and score history',
                ]).map((i) => (
                  <li key={i} className="flex gap-3 text-sm text-fg">
                    <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-accent-strong" strokeWidth={2} />
                    <span>{i}</span>
                  </li>
                ))}
              </ul>
              <a href="/register" className="mt-9 inline-flex w-full items-center justify-center rounded-xl bg-accent px-6 py-4 text-lead font-bold text-accent-fg shadow-[var(--shadow-cta)] transition-[background-color,box-shadow,transform] duration-[--dur] ease-[--ease-out-soft] hover:bg-accent-hover hover:-translate-y-0.5">Join the next batch →</a>

              <div className="mt-9 grid gap-5 border-t border-border pt-7 sm:grid-cols-3">
                <div className="flex items-start gap-2.5">
                  <CreditCard aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" strokeWidth={1.75} />
                  <div>
                    <p className="text-sm font-bold text-fg">Pay your way</p>
                    <p className="text-xs text-fg-muted">{PAYMENT_METHODS.join(' · ')}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" strokeWidth={1.75} />
                  <div>
                    <p className="text-sm font-bold text-fg">Verified by a person</p>
                    <p className="text-xs text-fg-muted">No automated billing</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Clock aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" strokeWidth={1.75} />
                  <div>
                    <p className="text-sm font-bold text-fg">No seat limit</p>
                    <p className="text-xs text-fg-muted">Join any open batch</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        <section className="border-t border-border bg-surface px-5 py-20 sm:px-8 sm:py-24">
          <Reveal className="mx-auto max-w-3xl">
            <h2 className="text-center font-display text-h1 text-fg">Pricing questions, answered.</h2>
            <div className="mt-10"><FaqAccordion items={PRICING_FAQ} /></div>
          </Reveal>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
