'use client';

import { useEffect, useState } from 'react';

/**
 * Chart colours read from the design tokens at runtime. SVG presentation attributes do not reliably
 * resolve CSS variables, so the token values are read once and passed as plain colours.
 */
export interface ChartColors { primary: string; success: string; warning: string; danger: string; info: string; accent: string; border: string; muted: string }

const FALLBACK: ChartColors = { primary: '#2563eb', success: '#16a34a', warning: '#d97706', danger: '#dc2626', info: '#0284c7', accent: '#0d9488', border: '#e2e8f0', muted: '#64748b' };
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
