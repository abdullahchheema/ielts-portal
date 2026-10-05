'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from './ChartFrame';
import { useChartColors } from './useChartColors';

/** How many students sit at each estimated band. Half-band steps from 0 to 9. */
export function DistributionChart({ bins, title = 'Estimated bands', description }: { bins: { band: number; count: number }[]; title?: string; description?: string }) {
  const c = useChartColors();
  const rows = bins.map((b) => ({ band: b.band.toFixed(1), count: b.count }));
  const empty = bins.every((b) => b.count === 0);
  return (
    <ChartFrame title={title} description={description} rows={rows} empty={empty} emptyText="No estimated bands yet. Scores appear here once students have graded work."
      columns={[{ key: 'band', label: 'Band' }, { key: 'count', label: 'Students' }]}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke={c.border} />
          <XAxis dataKey="band" tick={{ fill: c.muted, fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fill: c.muted, fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: c.border }} formatter={(v) => [`${v} students`, 'Count']} />
          <Bar dataKey="count" fill={c.primary} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
