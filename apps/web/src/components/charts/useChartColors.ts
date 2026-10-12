'use client';

import { useEffect, useState } from 'react';

/**
 * Chart colours read from the design tokens at runtime. SVG presentation attributes do not reliably
 * resolve CSS variables, so the token values are read once and passed as plain colours.
 */
export interface ChartColors { primary: string; success: string; warning: string; danger: string; info: string; accent: string; border: string; muted: string }

const FALLBACK: ChartColors = { primary: '#2A4494', success: '#1A7F4B', warning: '#B45309', danger: '#C0392B', info: '#0E7490', accent: '#0A7268', border: '#E5E1D9', muted: '#5F5E66' };
const NAMES: Record<keyof ChartColors, string> = { primary: '--primary', success: '--success', warning: '--warning', danger: '--danger', info: '--info', accent: '--accent-strong', border: '--border', muted: '--fg-muted' };

export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(FALLBACK);
  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const next = { ...FALLBACK };
    for (const key of Object.keys(NAMES) as (keyof ChartColors)[]) {
      next[key] = styles.getPropertyValue(NAMES[key]).trim() || FALLBACK[key];
    }
    setColors(next);
  }, []);
  return colors;
}
