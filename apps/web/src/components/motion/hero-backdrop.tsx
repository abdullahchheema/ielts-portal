'use client';

import { motion } from 'motion/react';

/**
 * Animated hero backdrop: two slow-drifting radial gradients plus a masked dot
 * grid. GPU-only properties (transform, opacity) so it stays smooth. `drift`
 * disables the looped motion for compact heroes (forms shouldn't jitter) while
 * keeping the static gradient layer for visual continuity across every page.
 */
export function HeroBackdrop({ drift = true }: { drift?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <motion.div
        className="absolute -left-1/4 -top-1/4 size-[50rem] rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgb(36 51 86 / .08), transparent)' }}
        animate={drift ? { x: [0, 30, 0], y: [0, -20, 0] } : undefined}
        transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -right-1/4 top-1/3 size-[42rem] rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgb(245 158 11 / .1), transparent)' }}
        animate={drift ? { x: [0, -24, 0], y: [0, 24, 0] } : undefined}
        transition={{ duration: 32, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div
        className="absolute inset-0 opacity-[0.4] [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)]"
        style={{ backgroundImage: 'radial-gradient(var(--border-strong) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
      />
    </div>
  );
}
