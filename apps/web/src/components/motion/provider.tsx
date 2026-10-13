'use client';

import { MotionConfig } from 'motion/react';
import { ReactNode } from 'react';

/** `reducedMotion="user"` makes every Motion animation in the app honour prefers-reduced-motion natively. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
