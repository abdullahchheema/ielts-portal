'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Field, Input, Loading, PageHeader, Section, StatCard, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { label, money } from '@/lib/format';

interface Finance {
  revenue: number; orders: number; discountsGiven: number; refunded: number; refundCount: number; refundRatePercent: number | null; netRevenue: number; couponRedemptions: number;
  ordersByStatus: Record<string, number>; byCourse: { course: string; batch: string; revenue: number; orders: number }[]; daily: { day: string; revenue: number; orders: number }[];
}
interface Academic {
  registrations: number; purchasingStudents: number; registrationToPurchasePercent: number | null;
  enrollments: { active: number; completed: number; expired: number }; completionRatePercent: number | null; averageProgressPercent: number;
  grading: { pending: number; gradedInRange: number; averageTurnaroundHours: number | null };
  assessments: { attempts: number; averagePercent: number; averageBand: number | null };
  averageBandImprovement: number | null; studentsWithImprovementData: number; attendance: { records: number; presentPercent: number | null };
}
interface Overview { range: { from: string; to: string }; finance: Finance | null; academic: Academic | null }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const pct = (v: number | null) => (v === null ? '—' : v + '%');

/** Revenue per day as a plain bar row (single measure, one axis, values in the table below). */
function RevenueBars({ daily }: { daily: Finance['daily'] }) {
  const max = Math.max(...daily.map((d) => d.revenue), 1);
  return (
    <figure className="rounded-lg bg-surface p-4 ring-1 ring-border">
      <figcaption className="mb-3 text-sm font-semibold">Revenue by day</figcaption>
      <div className="flex h-32 items-end gap-1" role="img" aria-label={'Daily revenue, peak ' + money(max)}>
        {daily.map((d) => (
          <div key={d.day} className="group relative flex-1" title={d.day + ': ' + money(d.revenue) + ' (' + d.orders + ' orders)'}>
            <div className="w-full rounded-t-sm bg-primary" style={{ height: Math.max(3, (d.revenue / max) * 100) + '%' }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-fg-muted"><span>{daily[0]?.day}</span><span>{daily[daily.length - 1]?.day}</span></div>
    </figure>
  );
}

export default function ReportsPage() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const { data, isLoading, isError } = useQuery({ queryKey: ['reports', from, to], queryFn: () => api<Overview>('/admin/reports/overview?from=' + from + '&to=' + to) });

  return (
    <>
      <PageHeader title="Reports" subtitle="Figures are computed from live records; refunded orders are shown separately from revenue." />
      <div className="mb-6 flex flex-wrap gap-3">
        <div className="w-44"><Field label="From">{(p) => <Input {...p} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field></div>
        <div className="w-44"><Field label="To">{(p) => <Input {...p} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field></div>
      </div>
      {isLoading && <Loading />}
      {isError && <Alert>Could not load reports.</Alert>}
      {data && !data.finance && !data.academic && <Alert kind="info">Your role does not include any report figures.</Alert>}
      {data?.finance && (
        <Section title="Finance">
          <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Revenue" value={money(data.finance.revenue)} hint={data.finance.orders + ' paid orders'} />
            <StatCard label="Refunded" value={money(data.finance.refunded)} hint={data.finance.refundCount + ' refunds · ' + pct(data.finance.refundRatePercent) + ' of gross'} />
            <StatCard label="Net revenue" value={money(data.finance.netRevenue)} />
            <StatCard label="Coupons used" value={String(data.finance.couponRedemptions)} hint={money(data.finance.discountsGiven) + ' discounted'} />
          </div>
          {data.finance.daily.length > 0 && <div className="mb-4"><RevenueBars daily={data.finance.daily} /></div>}
          <div className="grid gap-4 lg:grid-cols-2">
            <div><h3 className="mb-2 text-sm font-semibold text-fg">Revenue by course and batch</h3>
              {data.finance.byCourse.length === 0 ? <p className="text-sm text-fg-muted">No paid orders in this range.</p> : (
                <Table sticky head={['Course', 'Batch', 'Orders', 'Revenue']}>{data.finance.byCourse.map((r) => <tr key={r.course + r.batch}><Td>{r.course}</Td><Td>{r.batch}</Td><Td>{r.orders}</Td><Td>{money(r.revenue)}</Td></tr>)}</Table>)}
            </div>
            <div><h3 className="mb-2 text-sm font-semibold text-fg">Orders by status</h3>
              <Table sticky head={['Status', 'Orders']}>{Object.entries(data.finance.ordersByStatus).map(([s, n]) => <tr key={s}><Td>{label(s)}</Td><Td>{n}</Td></tr>)}</Table>
            </div>
          </div>
        </Section>
      )}
      {data?.academic && (
        <Section title="Academic & growth">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="New registrations" value={String(data.academic.registrations)} />
            <StatCard label="Registration → purchase" value={pct(data.academic.registrationToPurchasePercent)} hint={data.academic.purchasingStudents + ' students bought'} />
            <StatCard label="Active enrollments" value={String(data.academic.enrollments.active)} hint={data.academic.enrollments.completed + ' completed · ' + data.academic.enrollments.expired + ' expired'} />
            <StatCard label="Completion rate" value={pct(data.academic.completionRatePercent)} hint={'Avg progress ' + data.academic.averageProgressPercent + '%'} />
            <StatCard label="Awaiting grading" value={String(data.academic.grading.pending)} hint={data.academic.grading.gradedInRange + ' graded in range'} />
            <StatCard label="Grading turnaround" value={data.academic.grading.averageTurnaroundHours === null ? '—' : data.academic.grading.averageTurnaroundHours + ' h'} hint="Average, submission → graded" />
            <StatCard label="Test attempts" value={String(data.academic.assessments.attempts)} hint={'Average ' + data.academic.assessments.averagePercent + '%' + (data.academic.assessments.averageBand !== null ? ' · band ' + data.academic.assessments.averageBand : '')} />
            <StatCard label="Average band improvement" value={data.academic.averageBandImprovement === null ? '—' : (data.academic.averageBandImprovement > 0 ? '+' : '') + data.academic.averageBandImprovement} hint={data.academic.studentsWithImprovementData + ' students with 2+ scores'} />
            <StatCard label="Class attendance" value={pct(data.academic.attendance.presentPercent)} hint={data.academic.attendance.records + ' records'} />
          </div>
        </Section>
      )}
    </>
  );
}
