import { BadgeCheck, Headset, LucideIcon, ShieldCheck, Sparkles, Target, Users, Video, Wallet } from 'lucide-react';

/**
 * Honest, no-claims trust ribbon. Deliberately NOT a list of company logos — we have no verified
 * partnerships, and presenting real brands (OpenAI, exam boards, etc.) as partners without one would
 * be a false-endorsement problem. These are real, true-today facts about the product instead.
 */
const ITEMS: { icon: LucideIcon; text: string }[] = [
  { icon: Users, text: 'Live, teacher-led classes' },
  { icon: Sparkles, text: 'AI-assisted feedback' },
  { icon: Wallet, text: 'Payments verified by a person' },
  { icon: Target, text: 'All four modules, one course' },
  { icon: ShieldCheck, text: 'No seat limits, ever' },
  { icon: Video, text: 'Recorded speaking practice' },
  { icon: BadgeCheck, text: 'Progress tracked weekly' },
  { icon: Headset, text: 'A real person behind support' },
];

function Row({ ariaHidden }: { ariaHidden?: boolean }) {
  return (
    <div aria-hidden={ariaHidden} className="flex shrink-0 items-center gap-10 pr-10">
      {ITEMS.map((it) => (
        <span key={it.text} className="inline-flex items-center gap-2.5 whitespace-nowrap text-sm font-semibold text-fg-muted">
          <it.icon aria-hidden className="size-4.5 text-primary" strokeWidth={1.75} />
          {it.text}
        </span>
      ))}
    </div>
  );
}

/** Infinite horizontal ticker. Pure CSS (no JS, no layout thrash); pauses automatically under prefers-reduced-motion via the global kill-switch. */
export function TrustTicker() {
  return (
    <div className="overflow-hidden border-y border-border bg-surface py-5" role="group" aria-label="What's true about the course">
      <div className="flex w-max animate-[ticker_32s_linear_infinite] motion-reduce:animate-none">
        <Row />
        <Row ariaHidden />
      </div>
    </div>
  );
}
