'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { Alert, Badge, Card, Empty, PageHeader, Section, SkeletonCards, SkeletonTable, Table, Tabs, Td } from '@/components/ui';
import { EstimatedBand } from '@/components/EstimatedBand';
import { IeltsSummary, IeltsSummaryLike } from '@/components/IeltsSummary';
import { RiskBadge, type RiskLevelValue } from '@/components/RiskBadge';
import { LifecyclePanel } from '@/components/LifecyclePanel';
import { api } from '@/lib/api';
import { useUrlState } from '@/lib/url-state';
import { date, label, money } from '@/lib/format';

interface Detail {
  id: string; firstName: string; lastName: string; currentBand: string | null; targetBand: string | null; ieltsExamDate: string | null; country: string | null;
  ielts?: IeltsSummaryLike;
  user: { email: string; phone: string | null; status: string; createdAt: string; lastLoginAt: string | null };
  enrollments: { id: string; status: string; progressPercent: string; course: { title: string }; batch: { name: string } }[];
  orders: { id: string; reference: string; status: string; total: string; currency: string; createdAt: string }[];
  timeline: { id: string; type: string; summary: string; createdAt: string }[];
}

type SkillKey = 'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING';
type Trend = 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';
interface Analytics {
  band: {
    overall: number | null; overallPrevious: number | null; overallTrend: Trend;
    overallStatus: string; missingSkills: string[]; target: number | null; gapToTarget: number | null;
    skills: Record<SkillKey, { estimated: number | null; previous: number | null; trend: Trend; pointCount: number; latest: number | null; best: number | null; target: number | null; gapToTarget: number | null }>;
  };
  risk: { level: RiskLevelValue; reasons: string[]; positives: string[]; signals: { attendancePercent: number | null; daysSinceAcademicActivity: number | null; overdueCount: number; lateRecent: number } } | null;
}
interface AttendanceRow { date: string; topic: string; batch: string; status: string; note: string | null; markedAt: string | null }
interface AssessmentRow { title: string; skill: string | null; type: string; attemptNumber: number; status: string; submittedAt: string | null; score: string | null; percent: number | null; band: number | null }
interface AssignmentRow { title: string; skill: string; dueAt: string | null; status: string; submittedAt: string | null; late: boolean; band: number | null; gradedAt: string | null }

const TABS = [['overview', 'Overview'], ['performance', 'Performance'], ['attendance', 'Attendance'], ['assessments', 'Assessments'], ['assignments', 'Assignments'], ['activity', 'Activity'], ['account', 'Account']] as const;
const SKILLS: SkillKey[] = ['LISTENING', 'READING', 'WRITING', 'SPEAKING'];
const ATTENDANCE_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate'> = { PRESENT: 'green', LATE: 'amber', ABSENT: 'red', EXCUSED: 'blue' };

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const defaults = useMemo(() => ({ tab: 'overview' }), []);
  const [{ tab }, setTab] = useUrlState(defaults);

  const student = useQuery({ queryKey: ['admin-student', id], queryFn: () => api<Detail>(`/admin/students/${id}`) });
  const analytics = useQuery({ queryKey: ['admin-student-analytics', id], queryFn: () => api<Analytics>(`/admin/students/${id}/analytics`) });
  const attendance = useQuery({ queryKey: ['admin-student-attendance', id], queryFn: () => api<AttendanceRow[]>(`/admin/students/${id}/analytics/attendance`), enabled: tab === 'attendance' });
  const assessments = useQuery({ queryKey: ['admin-student-assessments', id], queryFn: () => api<AssessmentRow[]>(`/admin/students/${id}/analytics/assessments`), enabled: tab === 'assessments' });
  const assignments = useQuery({ queryKey: ['admin-student-assignments', id], queryFn: () => api<AssignmentRow[]>(`/admin/students/${id}/analytics/assignments`), enabled: tab === 'assignments' });

  if (student.isLoading) return <SkeletonTable rows={6} cols={5} />;
  if (student.isError || !student.data) return <Alert>Student not found.</Alert>;
  const s = student.data;
  const band = analytics.data?.band;

  return (
    <>
      <PageHeader
        title={`${s.firstName} ${s.lastName}`}
        subtitle={`${s.user.email}${s.user.phone ? ` · ${s.user.phone}` : ''}`}
        actions={<Badge status={s.user.status} />}
        breadcrumbs={[{ href: '/admin/students', label: 'Students' }, { label: `${s.firstName} ${s.lastName}` }]}
      />
      <div className="mb-6 overflow-x-auto">
        <Tabs aria-label="Student sections" variant="underline" value={tab} onChange={(k) => setTab({ tab: k })} items={TABS.map(([k, l]) => ({ key: k, label: l }))} />
      </div>
      <LifecyclePanel studentId={s.id} />

      {tab === 'overview' && (
        analytics.isLoading ? <SkeletonCards count={2} /> : analytics.isError || !band ? <Alert>Could not load this student’s analytics.</Alert> : (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <p className="mb-3 text-sm font-medium text-fg-muted">Risk</p>
              {analytics.data?.risk ? (
                <>
                  <RiskBadge level={analytics.data.risk.level} reasons={analytics.data.risk.reasons} showReasons />
                  {analytics.data.risk.level === 'GREEN' && analytics.data.risk.positives.length > 0 && (
                    <ul className="mt-3 list-inside list-disc text-sm text-fg-muted">{analytics.data.risk.positives.map((p) => <li key={p}>{p}</li>)}</ul>
                  )}
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-fg-muted">Attendance</dt><dd className="font-medium tabular-nums">{analytics.data.risk.signals.attendancePercent === null ? 'No sessions yet' : `${analytics.data.risk.signals.attendancePercent}%`}</dd></div>
                    <div><dt className="text-fg-muted">Last academic activity</dt><dd className="font-medium">{analytics.data.risk.signals.daysSinceAcademicActivity === null ? 'None yet' : `${analytics.data.risk.signals.daysSinceAcademicActivity} days ago`}</dd></div>
                    <div><dt className="text-fg-muted">Overdue work</dt><dd className="font-medium tabular-nums">{analytics.data.risk.signals.overdueCount}</dd></div>
                    <div><dt className="text-fg-muted">Late recently</dt><dd className="font-medium tabular-nums">{analytics.data.risk.signals.lateRecent}</dd></div>
                  </dl>
                </>
              ) : <p className="text-sm text-fg-muted">Not enrolled, so there is no risk to assess.</p>}
            </Card>
            <Card>
              <EstimatedBand value={band.overall} missingSkills={band.missingSkills.map((k) => label(k))} trend={band.overallTrend} delta={band.overall !== null && band.overallPrevious !== null ? Math.round((band.overall - band.overallPrevious) * 2) / 2 : null} />
              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-fg-muted">Target band</dt><dd className="font-medium tabular-nums">{band.target ?? 'Not set'}</dd></div>
                <div><dt className="text-fg-muted">Gap to target</dt><dd className="font-medium tabular-nums">{band.gapToTarget ?? '—'}</dd></div>
                <div><dt className="text-fg-muted">Exam date</dt><dd className="font-medium">{date(s.ieltsExamDate)}</dd></div>
                <div><dt className="text-fg-muted">Last login</dt><dd className="font-medium">{date(s.user.lastLoginAt, true)}</dd></div>
              </dl>
            </Card>
          </div>
        )
      )}

      {tab === 'performance' && (
        analytics.isLoading ? <SkeletonCards count={4} /> : analytics.isError || !band ? <Alert>Could not load this student’s performance.</Alert> : (
          <Section title="Estimated band by skill" description="Based on the latest scores, weighted towards the most recent. Auto-graded tests and teacher-graded work are combined.">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {SKILLS.map((k) => {
                const sk = band.skills[k];
                const delta = sk.estimated !== null && sk.previous !== null ? Math.round((sk.estimated - sk.previous) * 2) / 2 : null;
                return (
                  <Card key={k}>
                    <EstimatedBand label={label(k)} value={sk.estimated} trend={sk.trend} delta={delta} pointCount={sk.pointCount} />
                    {sk.gapToTarget !== null && <p className="mt-2 text-xs text-fg-muted">{sk.gapToTarget} below the {sk.target} target</p>}
                  </Card>
                );
              })}
            </div>
          </Section>
        )
      )}

      {tab === 'attendance' && (
        attendance.isLoading ? <SkeletonTable rows={6} cols={5} /> : attendance.isError || !attendance.data ? <Alert>Could not load attendance.</Alert> : attendance.data.length === 0 ? (
          <Empty title="No attendance yet">Attendance appears here once a teacher marks a class this student was enrolled for.</Empty>
        ) : (
          <Table head={['Date', 'Class', 'Batch', 'Status', 'Note']}>
            {attendance.data.map((r, i) => (
              <tr key={i}>
                <Td className="tabular-nums">{date(r.date, true)}</Td>
                <Td>{r.topic}</Td>
                <Td>{r.batch}</Td>
                <Td><Badge status={r.status} tone={ATTENDANCE_TONE[r.status]} text={label(r.status)} /></Td>
                <Td className="text-fg-muted">{r.note ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        )
      )}

      {tab === 'assessments' && (
        assessments.isLoading ? <SkeletonTable rows={6} cols={6} /> : assessments.isError || !assessments.data ? <Alert>Could not load assessments.</Alert> : assessments.data.length === 0 ? (
          <Empty title="No assessments yet">Attempts appear here as the student completes tests.</Empty>
        ) : (
          <Table head={['Test', 'Skill', 'Attempt', 'Submitted', 'Score', 'Band']}>
            {assessments.data.map((r, i) => (
              <tr key={i}>
                <Td className="font-medium">{r.title}</Td>
                <Td>{r.skill ? label(r.skill) : label(r.type)}</Td>
                <Td className="tabular-nums">#{r.attemptNumber}</Td>
                <Td>{date(r.submittedAt, true)}</Td>
                <Td className="tabular-nums">{r.score ?? (r.percent === null ? '—' : `${r.percent}%`)}</Td>
                <Td className="tabular-nums">{r.band ?? 'Not available'}</Td>
              </tr>
            ))}
          </Table>
        )
      )}

      {tab === 'assignments' && (
        assignments.isLoading ? <SkeletonTable rows={6} cols={6} /> : assignments.isError || !assignments.data ? <Alert>Could not load assignments.</Alert> : assignments.data.length === 0 ? (
          <Empty title="No assignments on this course">Writing and speaking tasks appear here once the course has them.</Empty>
        ) : (
          <Table head={['Task', 'Skill', 'Due', 'Status', 'Submitted', 'Band']}>
            {assignments.data.map((r, i) => (
              <tr key={i}>
                <Td className="font-medium">{r.title}</Td>
                <Td>{label(r.skill)}</Td>
                <Td>{date(r.dueAt)}</Td>
                <Td><Badge status={r.status} tone={r.status === 'OVERDUE' ? 'red' : r.status === 'NOT_SUBMITTED' ? 'slate' : undefined} text={label(r.status)} /></Td>
                <Td>{r.submittedAt ? `${date(r.submittedAt, true)}${r.late ? ' (late)' : ''}` : '—'}</Td>
                <Td className="tabular-nums">{r.band ?? 'Not graded'}</Td>
              </tr>
            ))}
          </Table>
        )
      )}

      {tab === 'activity' && (
        <Card>
          <h2 className="mb-3 font-display text-base font-semibold text-fg">Timeline</h2>
          <ol className="space-y-3 border-l-2 border-border pl-4 text-sm">
            {s.timeline.length === 0 && <li className="text-fg-muted">No activity yet.</li>}
            {s.timeline.map((t) => <li key={t.id}><p className="text-xs text-fg-muted">{date(t.createdAt, true)}</p><p>{t.summary}</p></li>)}
          </ol>
        </Card>
      )}

      {tab === 'account' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <Card>
              <p className="mb-2 text-sm font-medium text-fg-muted">Self-reported IELTS history</p>
              <IeltsSummary ielts={s.ielts} />
            </Card>
            <Section title="Enrollments">
              {s.enrollments.length === 0 ? <p className="text-sm text-fg-muted">None.</p> : (
                <Table head={['Course', 'Batch', 'Progress', 'Status']}>
                  {s.enrollments.map((e) => <tr key={e.id}><Td>{e.course.title}</Td><Td>{e.batch.name}</Td><Td className="tabular-nums">{Math.round(Number(e.progressPercent))}%</Td><Td><Badge status={e.status} /></Td></tr>)}
                </Table>
              )}
            </Section>
            <Section title="Orders">
              {s.orders.length === 0 ? <p className="text-sm text-fg-muted">None.</p> : (
                <Table head={['Reference', 'Total', 'Status', 'Date']}>
                  {s.orders.map((o) => <tr key={o.id}><Td className="font-mono text-xs">{o.reference}</Td><Td className="tabular-nums">{money(o.total, o.currency)}</Td><Td><Badge status={o.status} /></Td><Td>{date(o.createdAt)}</Td></tr>)}
                </Table>
              )}
            </Section>
          </div>
        </div>
      )}
    </>
  );
}
