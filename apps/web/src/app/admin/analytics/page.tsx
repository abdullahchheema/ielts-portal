'use client';

import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, ClickableRow, FilterBar, Pagination, PageHeader, Section, SearchInput, Select, SkeletonCards, SkeletonTable, StatCard, Table, Td, useConfirm } from '@/components/ui';
import { DistributionChart } from '@/components/charts/DistributionChart';
import { RiskDonut } from '@/components/charts/RiskDonut';
import { RiskBadge, type RiskLevelValue } from '@/components/RiskBadge';
import { api, ApiError } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { useUrlState } from '@/lib/url-state';
import { band as fmt } from '@/lib/format';

interface Kpis {
  students: { total: number };
  risk: { green: number; yellow: number; red: number };
  attendance: { averagePercent: number | null; measured: number };
  bands: { averageOverall: number | null; withFullData: number };
  suppressed: boolean;
}
interface CohortRow {
  studentId: string; name: string; email: string; batchName: string; level: RiskLevelValue; reasons: string[];
  estimatedOverall: number | null; target: number | null; attendancePercent: number | null; daysSinceAcademicActivity: number | null;
}
interface Attention { counts: { red: number; yellow: number; green: number }; items: CohortRow[] }
interface StudentPage { total: number; truncated: boolean; items: CohortRow[] }

const PAGE = 25;
const LEVELS = [['', 'All levels'], ['RED', 'At risk'], ['YELLOW', 'Needs attention'], ['GREEN', 'On track']] as const;

export default function AdminAnalyticsPage() {
  const confirm = useConfirm();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const defaults = useMemo(() => ({ level: '', search: '', skip: '0' }), []);
  const [filters, setFilters] = useUrlState(defaults);
  const skip = Number(filters.skip) || 0;

  const kpis = useQuery({ queryKey: ['analytics-kpis'], queryFn: () => api<Kpis>('/admin/analytics/kpis') });
  const attention = useQuery({ queryKey: ['analytics-attention'], queryFn: () => api<Attention>('/admin/analytics/needs-attention?take=8') });
  const qs = new URLSearchParams({ ...(filters.level ? { level: filters.level } : {}), ...(filters.search ? { search: filters.search } : {}), skip: String(skip), take: String(PAGE) }).toString();
  const students = useQuery({ queryKey: ['analytics-students', qs], queryFn: () => api<StudentPage>(`/admin/analytics/students?${qs}`) });

  async function exportCsv() {
    setExportError(null);
    if (!(await confirm({ title: 'Download student data?', message: 'This file contains student names, emails and performance. Keep it safe and delete it when you no longer need it.', confirmLabel: 'Download' }))) return;
    setExporting(true);
    try {
      await downloadCsv(`/admin/analytics/export/students.csv?${new URLSearchParams({ ...(filters.level ? { level: filters.level } : {}), ...(filters.search ? { search: filters.search } : {}) }).toString()}`);
    } catch (e) {
      setExportError(e instanceof ApiError ? e.message : errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="How students are doing right now. Every figure comes from recorded attendance, graded work and course activity."
        breadcrumbs={[{ label: 'Admin' }, { label: 'Analytics' }]}
        actions={<Button variant="secondary" onClick={exportCsv} busy={exporting}><Download aria-hidden className="size-4" />Export CSV</Button>}
      />
      {exportError && <div className="mb-6"><Alert>{exportError}</Alert></div>}

      <Section title="Overview">
        {kpis.isLoading ? <SkeletonCards count={4} /> : kpis.isError || !kpis.data ? <Alert>Could not load the overview.</Alert> : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Students on course" value={kpis.data.students.total} />
              <StatCard label="At risk" value={kpis.data.risk.red} attention={kpis.data.risk.red > 0} hint={`${kpis.data.risk.yellow} need attention`} />
              <StatCard label="Average attendance" value={kpis.data.attendance.averagePercent === null ? 'Not enough data' : `${kpis.data.attendance.averagePercent}%`} hint={kpis.data.suppressed ? 'Hidden below 3 students to protect privacy' : `${kpis.data.attendance.measured} students measured`} />
              <StatCard label="Average estimated band" value={kpis.data.bands.averageOverall === null ? 'Not enough data' : fmt(kpis.data.bands.averageOverall)} hint={`${kpis.data.bands.withFullData} students with all four skills`} />
            </div>
          </>
        )}
      </Section>

      <Section title="Where the academy stands" description="Risk levels and where estimated bands sit across the cohort.">
        {kpis.data && (
          <div className="grid gap-6 lg:grid-cols-2">
            <RiskDonut green={kpis.data.risk.green} yellow={kpis.data.risk.yellow} red={kpis.data.risk.red} />
            <DistributionChart bins={bandBins(students.data?.items ?? [])} description="Students by estimated overall band, from the current page." />
          </div>
        )}
      </Section>

      <Section title="Needs attention" description="Students flagged at risk or needing attention first. Select one to see why.">
        {attention.isLoading ? <SkeletonTable rows={4} cols={3} /> : attention.isError || !attention.data ? <Alert>Could not load the list.</Alert> : attention.data.items.length === 0 ? (
          <p className="rounded-lg bg-surface p-6 text-sm text-fg-muted ring-1 ring-border">No students need attention right now.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg bg-surface ring-1 ring-border">
            {attention.data.items.map((r) => (
              <li key={r.studentId} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <Link href={`/admin/students/${r.studentId}?tab=overview`} className="font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring">{r.name}</Link>
                  <p className="text-xs text-fg-muted">{r.batchName}</p>
                  <ul className="mt-1.5 list-inside list-disc text-xs text-fg-muted">{r.reasons.slice(0, 3).map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
                <RiskBadge level={r.level} reasons={r.reasons} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Students">
        <FilterBar count={students.data?.total}>
          <SearchInput label="Search students" placeholder="Name or email" value={filters.search} onDebounced={(v) => setFilters({ search: v, skip: '0' })} />
          <Select aria-label="Risk level" className="!w-auto" value={filters.level} onChange={(e) => setFilters({ level: e.target.value, skip: '0' })}>
            {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </FilterBar>
        {students.isLoading ? <SkeletonTable rows={8} cols={6} /> : students.isError || !students.data ? <Alert>Could not load students.</Alert> : students.data.items.length === 0 ? (
          <p className="rounded-lg bg-surface p-6 text-sm text-fg-muted ring-1 ring-border">No students match these filters.</p>
        ) : (
          <>
            <Table head={['Student', 'Batch', 'Risk', 'Estimated band', 'Attendance', 'Last activity']}>
              {students.data.items.map((r) => (
                <ClickableRow key={r.studentId} onClick={() => { window.location.href = `/admin/students/${r.studentId}`; }}>
                  <Td><span className="font-medium">{r.name}</span><span className="block text-xs text-fg-muted">{r.email}</span></Td>
                  <Td>{r.batchName}</Td>
                  <Td><Badge status={r.level} tone={r.level === 'GREEN' ? 'green' : r.level === 'YELLOW' ? 'amber' : 'red'} text={r.level === 'GREEN' ? 'On track' : r.level === 'YELLOW' ? 'Needs attention' : 'At risk'} /></Td>
                  <Td className="tabular-nums">{r.estimatedOverall === null ? 'Not available' : fmt(r.estimatedOverall)}</Td>
                  <Td className="tabular-nums">{r.attendancePercent === null ? '—' : `${r.attendancePercent}%`}</Td>
                  <Td className="tabular-nums">{r.daysSinceAcademicActivity === null ? 'None yet' : `${r.daysSinceAcademicActivity} days ago`}</Td>
                </ClickableRow>
              ))}
            </Table>
            <Pagination skip={skip} take={PAGE} total={students.data.total} onSkip={(next) => setFilters({ skip: String(next) })} />
          </>
        )}
      </Section>
    </>
  );
}

/** Bins estimated overall bands into half-band steps for the histogram. */
function bandBins(rows: CohortRow[]) {
  const counts = new Map<number, number>();
  for (let b = 0; b <= 9; b += 0.5) counts.set(b, 0);
  for (const r of rows) {
    if (r.estimatedOverall === null) continue;
    counts.set(r.estimatedOverall, (counts.get(r.estimatedOverall) ?? 0) + 1);
  }
  return [...counts.entries()].map(([band, count]) => ({ band, count }));
}
