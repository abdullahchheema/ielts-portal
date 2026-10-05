'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Badge, Empty, Section, SkeletonTable, StatCard, Table, Td } from '@/components/ui';
import { RiskBadge, type RiskLevelValue } from '@/components/RiskBadge';
import { api } from '@/lib/api';
import { band as fmt } from '@/lib/format';

interface Row {
  studentId: string; name: string; level: RiskLevelValue; reasons: string[]; estimatedOverall: number | null; overallStatus: string;
  target: number | null; gapToTarget: number | null; attendancePercent: number | null; daysSinceAcademicActivity: number | null;
}
interface Analytics {
  truncated: boolean;
  summary: { students: number; atRisk: number; needsAttention: number; averageAttendance: number | null };
  items: Row[];
}

/** The teacher's view of one batch: who is at risk and why, with the estimated band beside each student. */
export function BatchAnalytics({ batchId }: { batchId: string }) {
  const q = useQuery({ queryKey: ['batch-analytics', batchId], queryFn: () => api<Analytics>(`/mentor/batches/${batchId}/analytics`) });
  if (q.isLoading) return <SkeletonTable rows={6} cols={5} />;
  if (q.isError || !q.data) return <Alert>Could not load this batch’s analytics.</Alert>;
  const { summary, items } = q.data;
  return (
    <>
      <Section>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Students" value={summary.students} />
          <StatCard label="At risk" value={summary.atRisk} attention={summary.atRisk > 0} hint="Reasons are listed per student" />
          <StatCard label="Needs attention" value={summary.needsAttention} attention={summary.needsAttention > 0} />
          <StatCard label="Average attendance" value={summary.averageAttendance === null ? 'Not enough data' : `${summary.averageAttendance}%`} hint="Excludes excused absences" />
        </div>
      </Section>
      {q.data.truncated && <div className="mb-4"><Alert kind="info">This batch is larger than the view can load. Some students are not shown.</Alert></div>}
      {items.length === 0 ? (
        <Empty title="No students yet">Students appear here once they are enrolled in this batch.</Empty>
      ) : (
        <Table head={['Student', 'Risk', 'Estimated band', 'Attendance', 'Last academic activity']}>
          {items.map((r) => (
            <tr key={r.studentId}>
              <Td className="font-medium"><Link href={`/teacher/students/${r.studentId}`} className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring">{r.name}</Link></Td>
              <Td><RiskBadge level={r.level} reasons={r.reasons} showReasons /></Td>
              <Td className="tabular-nums">{r.estimatedOverall === null ? <Badge status="PENDING" tone="slate" text="Not available" /> : fmt(r.estimatedOverall)}</Td>
              <Td className="tabular-nums">{r.attendancePercent === null ? '—' : `${r.attendancePercent}%`}</Td>
              <Td className="tabular-nums">{r.daysSinceAcademicActivity === null ? 'None yet' : `${r.daysSinceAcademicActivity} days ago`}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
