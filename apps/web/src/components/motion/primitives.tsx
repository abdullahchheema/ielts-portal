'use client';

import { animate, motion, useInView } from 'motion/react';
import { ElementType, ReactNode, useEffect, useRef, useState } from 'react';
import { fadeUp, staggerParent } from './variants';

/**
 * Thin client wrappers around Motion. Each one wraps server-rendered children
 * rather than owning data, so pages that fetch via `publicGet` stay server
 * components — only these leaf components cross the client boundary.
 */

export function Reveal({ children, className, as = 'div', delay = 0 }: { children: ReactNode; className?: string; as?: ElementType; delay?: number }) {
  const MotionTag = motion.create(as);
  return (
    <MotionTag
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.25 }}
      variants={fadeUp}
      transition={{ delay }}
    >
      {children}
    </MotionTag>
  );
}

export function Stagger({ children, className, stagger = 0.08 }: { children: ReactNode; className?: string; stagger?: number }) {
  return (
    <motion.div className={className} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }} variants={staggerParent(stagger)}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return <motion.div className={className} variants={fadeUp}>{children}</motion.div>;
}

/** Hover/tap lift for anything that should feel pressable but can't use the CSS `LIFT` class (e.g. needs a spring). */
export function Lift({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} whileHover={{ y: -3 }} whileTap={{ y: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 28 }}>
      {children}
    </motion.div>
  );
}

/** Counts up to `value` once it scrolls into view — used for hero/stat figures. */
export function CountUp({ value, suffix = '', className }: { value: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, value, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, value]);

  return <span ref={ref} className={className}>{display.toLocaleString()}{suffix}</span>;
}
