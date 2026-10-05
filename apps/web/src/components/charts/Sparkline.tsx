/** Inline trend in a stat card. Hand-drawn SVG: far cheaper than a chart library for one small line. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const w = 96, h = 28, pad = 2;
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - lo) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={w} height={h} role="img" aria-label={`${label}: ${values[0]} to ${values[values.length - 1]}`} className="text-primary">
      <polyline points={pts.join(' ')} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
