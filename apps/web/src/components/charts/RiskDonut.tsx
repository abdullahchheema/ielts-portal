'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ChartFrame } from './ChartFrame';
import { useChartColors } from './useChartColors';

/** Students by risk level. Always shown beside the table, and labelled in text, not colour alone. */
export function RiskDonut({ green, yellow, red }: { green: number; yellow: number; red: number }) {
  const c = useChartColors();
  const rows = [
    { level: 'On track', count: green, color: c.success },
    { level: 'Needs attention', count: yellow, color: c.warning },
    { level: 'At risk', count: red, color: c.danger },
  ];
  const empty = green + yellow + red === 0;
  return (
    <ChartFrame title="Students by risk" description="Each student is assigned exactly one level, with reasons." rows={rows.map(({ level, count }) => ({ level, count }))} empty={empty}
      emptyText="No students are enrolled yet, so there is no risk to show."
      columns={[{ key: 'level', label: 'Level' }, { key: 'count', label: 'Students' }]}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={rows} dataKey="count" nameKey="level" innerRadius="58%" outerRadius="90%" isAnimationActive={false} stroke="none">
            {rows.map((r) => <Cell key={r.level} fill={r.color} />)}
          </Pie>
          <Tooltip formatter={(v, n) => [`${v} students`, String(n)]} />
        </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
