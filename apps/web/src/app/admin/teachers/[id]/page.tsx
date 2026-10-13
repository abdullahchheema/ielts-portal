'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { Alert, Badge, Card, DefinitionList, Empty, PageHeader, Section, SkeletonCards, SkeletonTable, Table, Tabs, Td } from '@/components/ui';
import { ActivitySummaryList, DailyActivityRow } from '@/components/ActivitySummaryList';
import { api } from '@/lib/api';
import { useUrlState } from '@/lib/url-state';
import { date, label } from '@/lib/format';

interface TeacherActivity {
  id: string; displayName: string; status: string; email: string; lastLoginAt: string | null;
  batches: { id: string; name: string; status: string; role: string; assignedAt: string }[];
  grading: {
    totalGraded: number; last30Days: number; avgTurnaroundHours: number | null;
    recent: { id: string; student: string; title: string; skill: string; band: number | null; comment: string | null; submittedAt: string; gradedAt: string }[];
  };
  attendanceMarkedCount: number;
}

const TABS = [['overview', 'Overview'], ['batches', 'Batches'], ['grading', 'Grading'], ['activity', 'Activity']] as const;

/** Everything about a teacher's day-to-day teaching activity — batches taught, grading volume and
 * turnaround, recent feedback given. HR/application data stays in the existing teacher list dialog;
 * this page is purely about what the teacher has been doing. */
export default function TeacherDetailPage() {
  const { id } = useParams<{ id: string }>();
  const defaults = useMemo(() => ({ tab: 'overview' }), []);
  const [{ tab }, setTab] = useUrlState(defaults);

  const activity = useQuery({ queryKey: ['admin-teacher-activity', id], queryFn: () => api<TeacherActivity>(`/admin/mentors/${id}/activity`) });
  const activitySummary = useQuery({ queryKey: ['admin-teacher-activity-summary', id], queryFn: () => api<DailyActivityRow[]>(`/admin/mentors/${id}/activity-summary`), enabled: tab === 'activity' });

  if (activity.isLoading) return <SkeletonTable rows={6} cols={5} />;
  if (activity.isError || !activity.data) return <Alert>Teacher not found.</Alert>;
  const t = activity.data;

  return (
    <>
      <PageHeader
        title={t.displayName}
        subtitle={`${t.email} · last login ${date(t.lastLoginAt, true)}`}
        actions={<Badge status={t.status} />}
        breadcrumbs={[{ href: '/admin/teachers', label: 'Teachers' }, { label: t.displayName }]}
      />
      <div className="mb-6 overflow-x-auto">
        <Tabs aria-label="Teacher sections" variant="underline" value={tab} onChange={(k) => setTab({ tab: k })} items={TABS.map(([k, l]) => ({ key: k, label: l }))} />
      </div>

      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <p className="mb-3 text-sm font-medium text-fg-muted">Grading activity</p>
            <DefinitionList items={[
              { label: 'Total graded', value: t.grading.totalGraded },
              { label: 'Graded in last 30 days', value: t.grading.last30Days },
              { label: 'Average turnaround', value: t.grading.avgTurnaroundHours === null ? 'Not enough data' : `${t.grading.avgTurnaroundHours} hours` },
              { label: 'Attendance records marked', value: t.attendanceMarkedCount },
            ]} />
          </Card>
          <Card>
            <p className="mb-3 text-sm font-medium text-fg-muted">Batches taught</p>
            {t.batches.length === 0 ? <p className="text-sm text-fg-muted">Not assigned to any batch yet.</p> : (
              <ul className="space-y-2 text-sm">
                {t.batches.map((b) => (
                  <li key={`${b.id}-${b.role}`} className="flex items-center justify-between gap-3">
                    <span className="text-fg">{b.name} <span className="text-fg-muted">· {label(b.role)}</span></span>
                    <Badge status={b.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === 'batches' && (
        t.batches.length === 0 ? <Empty title="No batches assigned">This teacher is not assigned to any batch yet.</Empty> : (
          <Table head={['Batch', 'Role', 'Status', 'Assigned']} sticky>
            {t.batches.map((b) => (
              <tr key={`${b.id}-${b.role}`}>
                <Td className="font-medium">{b.name}</Td>
                <Td>{label(b.role)}</Td>
                <Td><Badge status={b.status} /></Td>
                <Td>{date(b.assignedAt)}</Td>
              </tr>
            ))}
          </Table>
        )
      )}

      {tab === 'grading' && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Card><p className="text-xs font-medium text-fg-muted">Total graded</p><p className="mt-1 font-display text-2xl font-bold text-fg">{t.grading.totalGraded}</p></Card>
            <Card><p className="text-xs font-medium text-fg-muted">Last 30 days</p><p className="mt-1 font-display text-2xl font-bold text-fg">{t.grading.last30Days}</p></Card>
            <Card><p className="text-xs font-medium text-fg-muted">Avg. turnaround</p><p className="mt-1 font-display text-2xl font-bold text-fg">{t.grading.avgTurnaroundHours === null ? '—' : `${t.grading.avgTurnaroundHours}h`}</p></Card>
          </div>
          <Section title="Recent feedback given">
            {t.grading.recent.length === 0 ? <Empty title="No grading yet">Graded work will appear here once this teacher marks a submission.</Empty> : (
              <Table head={['Student', 'Task', 'Skill', 'Band', 'Submitted', 'Graded']} sticky>
                {t.grading.recent.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">{r.student}</Td>
                    <Td>{r.title}</Td>
                    <Td>{label(r.skill)}</Td>
                    <Td className="tabular-nums">{r.band ?? '—'}</Td>
                    <Td>{date(r.submittedAt, true)}</Td>
                    <Td>{date(r.gradedAt, true)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Section>
        </>
      )}

      {tab === 'activity' && (
        <Section title="Daily activity" description="Logins, lessons opened, grading and classes attended — the last 14 days.">
          {activitySummary.isLoading ? <SkeletonCards count={3} /> : activitySummary.isError || !activitySummary.data ? <Alert>Could not load activity.</Alert> : (
            <ActivitySummaryList rows={activitySummary.data} />
          )}
        </Section>
      )}
    </>
  );
}
