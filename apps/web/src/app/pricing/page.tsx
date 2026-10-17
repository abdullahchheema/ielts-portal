import { Check, CreditCard, ShieldCheck, X } from 'lucide-react';
import { FaqAccordion } from '@/components/MarketingInteractive';
import { Reveal } from '@/components/motion/primitives';
import { PageHero } from '@/components/public/page-hero';
import { PublicFooter } from '@/components/PublicFooter';
import { PublicHeader } from '@/components/PublicHeader';
import { money } from '@/lib/format';
import { PublicPlan, publicGet } from '@/lib/server-api';

export const revalidate = 120;
export const metadata = { title: 'Pricing — Connect IELTS Academy' };

const PAYMENT_METHODS = ['Bank transfer', 'JazzCash', 'Easypaisa'];

const FEATURE_ROWS: { key: keyof PublicPlan['features']; label: string }[] = [
  { key: 'assessment.free_test', label: 'One free diagnostic test' },
  { key: 'assessment.detailed_results', label: 'Full results and answer keys' },
  { key: 'practice.unlimited', label: 'Unlimited practice' },
  { key: 'mock.unlimited', label: 'Unlimited mock tests' },
  { key: 'ai.evaluation', label: 'AI writing & speaking evaluation' },
  { key: 'teacher.assignment', label: 'Dedicated teacher' },
  { key: 'class.access', label: 'Live weekday classes' },
  { key: 'premium.services', label: 'Consultancy, scholarships, career counseling' },
];

const PRICING_FAQ = [
  { q: 'Is this a subscription?', a: 'No. Paid plans are a one-time payment covering your access window. There is no recurring charge.' },
  { q: 'How do I pay?', a: `By ${PAYMENT_METHODS.join(', ')}, or another method you arrange with us. Upload a clear photo or PDF of your receipt with your application.` },
  { q: 'How fast is payment verified?', a: 'A real person on our team checks every payment proof, usually within one working day. Your portal opens as soon as it is confirmed.' },
  { q: 'What if my proof is rejected?', a: 'You will see the reason directly in your application and can upload a corrected proof — nothing is lost and you do not need to start over.' },
  { q: 'Can I try before I pay?', a: 'Yes — take one free diagnostic test with just your email and phone, no account needed, to see your overall score.' },
];

function FeatureCell({ has }: { has: boolean }) {
  return has
    ? <Check aria-label="Included" className="mx-auto size-5 text-success" strokeWidth={2.25} />
    : <X aria-label="Not included" className="mx-auto size-5 text-fg-subtle" strokeWidth={2} />;
}

export default async function PricingPage() {
  const plans = await publicGet<PublicPlan[]>('/public/plans', 120);
  const ordered = plans ?? [];

  return (
    <div className="bg-canvas">
      <PublicHeader />
      <main>
        <PageHero
          size="standard"
          className="bg-wash"
          eyebrow="Pricing"
          title="Four plans. Pick the level of support you need."
          subtitle="Try a free test with no account, then choose Starter, Advanced or Premium for the full course experience."
        />

        <Reveal as="section" className="px-5 pt-6 pb-20 sm:px-8 sm:pt-8 sm:pb-24">
          <div className="mx-auto max-w-6xl overflow-x-auto">
            <div className="grid min-w-[880px] grid-cols-4 gap-4">
              {ordered.map((p) => (
                <div key={p.name} className={`flex flex-col overflow-hidden rounded-2xl bg-surface shadow-lg ring-1 ${p.name === 'PREMIUM' ? 'ring-2 ring-accent' : 'ring-border'}`}>
                  <div className="bg-ink px-5 py-7 text-center text-white">
                    <p className="text-overline font-bold uppercase text-white/70">{p.displayName}</p>
                    <p className="mt-3 font-display text-3xl font-extrabold">{p.price > 0 ? money(p.price, p.currency) : 'Free'}</p>
                    {p.durationDays && <p className="mt-1 text-xs text-white/70">{Math.round(p.durationDays / 30)} month access</p>}
                  </div>
                  <div className="flex-1 p-5">
                    {p.description && <p className="mb-4 text-sm text-fg-muted">{p.description}</p>}
                    <ul className="space-y-2.5 text-sm">
                      {FEATURE_ROWS.filter((f) => p.features[f.key]).map((f) => (
                        <li key={f.key} className="flex items-start gap-2">
                          <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" strokeWidth={2.25} />
                          <span>{f.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="p-5 pt-0">
                    <a
                      href={p.name === 'FREE' ? '/free-test' : `/register?plan=${p.name.toLowerCase()}`}
                      className={`inline-flex w-full items-center justify-center rounded-xl px-5 py-3 text-sm font-bold transition-[background-color,transform] duration-[--dur] ease-[--ease-out-soft] hover:-translate-y-0.5 ${
                        p.name === 'PREMIUM' ? 'bg-accent text-accent-fg hover:bg-accent-hover' : 'bg-surface-muted text-fg hover:bg-border'
                      }`}
                    >
                      {p.name === 'FREE' ? 'Start the free test' : 'Register'}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {ordered.length > 0 && (
            <div className="mx-auto mt-14 max-w-5xl overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-3 text-left font-semibold text-fg-muted">Feature</th>
                    {ordered.map((p) => <th key={p.name} className="p-3 text-center font-semibold text-fg">{p.displayName}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_ROWS.map((f) => (
                    <tr key={f.key} className="border-b border-border/60">
                      <td className="p-3 text-fg-muted">{f.label}</td>
                      {ordered.map((p) => <td key={p.name} className="p-3 text-center"><FeatureCell has={!!p.features[f.key]} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mx-auto mt-10 grid max-w-3xl gap-5 sm:grid-cols-2">
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
