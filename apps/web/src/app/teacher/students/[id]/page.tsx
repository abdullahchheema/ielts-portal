'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { Alert, Badge, Card, Empty, PageHeader, SkeletonCards, SkeletonTable, Table, Tabs, Td } from '@/components/ui';
import { EstimatedBand } from '@/components/EstimatedBand';
import { RiskBadge, type RiskLevelValue } from '@/components/RiskBadge';
import { api } from '@/lib/api';
import { useUrlState } from '@/lib/url-state';
import { date, label } from '@/lib/format';

type SkillKey = 'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING';
type Trend = 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';
interface Detail {
  name: string; target: number | null; examDate: string | null;
  band: { overall: number | null; overallTrend: Trend; overallStatus: string; missingSkills: string[]; skills: Record<SkillKey, { estimated: number | null; trend: Trend; pointCount: number }> };
  risk: { level: RiskLevelValue; reasons: string[]; positives: string[] } | null;
  attendance: { date: string; topic: string; batch: string; status: string; note: string | null }[];
  assessments: { title: string; skill: string | null; type: string; attemptNumber: number; status: string; submittedAt: string | null; score: string | null; percent: number | null; band: number | null }[];
  assignments: { title: string; skill: string; dueAt: string | null; status: string; submittedAt: string | null; late: boolean; band: number | null }[];
}

const TABS = [['overview', 'Overview'], ['attendance', 'Attendance'], ['assessments', 'Assessments'], ['assignments', 'Assignments']] as const;
const SKILLS: SkillKey[] = ['LISTENING', 'READING', 'WRITING', 'SPEAKING'];

/** A teacher's view of one of their students. Only students in the teacher's own batches are available. */
export default function TeacherStudentPage() {
  const { id } = useParams<{ id: string }>();
  const defaults = useMemo(() => ({ tab: 'overview' }), []);
  const [{ tab }, setTab] = useUrlState(defaults);
  const q = useQuery({ queryKey: ['teacher-student', id], queryFn: () => api<Detail>(`/mentor/students/${id}/analytics`) });

  if (q.isLoading) return <SkeletonCards count={3} />;
  if (q.isError || !q.data) return <Alert>This student is not in one of your batches.</Alert>;
  const d = q.data;

  return (
    <>
      <PageHeader title={d.name} subtitle={d.target === null ? 'No target set' : `Target band ${d.target}`} breadcrumbs={[{ href: '/teacher/batches', label: 'My batches' }, { label: d.name }]} />
      <div className="mb-6 overflow-x-auto">
        <Tabs aria-label="Student sections" variant="underline" value={tab} onChange={(k) => setTab({ tab: k })} items={TABS.map(([k, l]) => ({ key: k, label: l }))} />
      </div>

      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <p className="mb-3 text-sm font-medium text-fg-muted">Risk</p>
            {d.risk ? (
              <>
                <RiskBadge level={d.risk.level} reasons={d.risk.reasons} showReasons />
                {d.risk.level === 'GREEN' && d.risk.positives.length > 0 && <ul className="mt-3 list-inside list-disc text-sm text-fg-muted">{d.risk.positives.map((p) => <li key={p}>{p}</li>)}</ul>}
              </>
            ) : <p className="text-sm text-fg-muted">No risk to assess yet.</p>}
          </Card>
          <Card>
            <EstimatedBand value={d.band.overall} missingSkills={d.band.missingSkills.map((k) => label(k))} trend={d.band.overallTrend} />
            <div className="mt-5 grid grid-cols-2 gap-4">
              {SKILLS.map((k) => (
                <EstimatedBand key={k} label={label(k)} value={d.band.skills[k].estimated} trend={d.band.skills[k].trend} pointCount={d.band.skills[k].pointCount} />
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === 'attendance' && (d.attendance.length === 0 ? <Empty title="No attendance yet">Marks appear here once classes are recorded.</Empty> : (
        <Table head={['Date', 'Class', 'Batch', 'Status', 'Note']}>
          {d.attendance.map((r, i) => (
            <tr key={i}><Td className="tabular-nums">{date(r.date, true)}</Td><Td>{r.topic}</Td><Td>{r.batch}</Td><Td><Badge status={r.status} text={label(r.status)} /></Td><Td className="text-fg-muted">{r.note ?? '—'}</Td></tr>
          ))}
        </Table>
      ))}

      {tab === 'assessments' && (d.assessments.length === 0 ? <Empty title="No assessments yet">Attempts appear here as the student completes tests.</Empty> : (
        <Table head={['Test', 'Skill', 'Attempt', 'Submitted', 'Score', 'Band']}>
          {d.assessments.map((r, i) => (
            <tr key={i}><Td className="font-medium">{r.title}</Td><Td>{r.skill ? label(r.skill) : label(r.type)}</Td><Td className="tabular-nums">#{r.attemptNumber}</Td><Td>{date(r.submittedAt, true)}</Td><Td className="tabular-nums">{r.score ?? (r.percent === null ? '—' : `${r.percent}%`)}</Td><Td className="tabular-nums">{r.band ?? 'Not available'}</Td></tr>
          ))}
        </Table>
      ))}

      {tab === 'assignments' && (d.assignments.length === 0 ? <Empty title="No assignments yet">Writing and speaking tasks appear here once the course has them.</Empty> : (
        <Table head={['Task', 'Skill', 'Due', 'Status', 'Submitted', 'Band']}>
          {d.assignments.map((r, i) => (
            <tr key={i}><Td className="font-medium">{r.title}</Td><Td>{label(r.skill)}</Td><Td>{date(r.dueAt)}</Td><Td><Badge status={r.status} text={label(r.status)} /></Td><Td>{r.submittedAt ? `${date(r.submittedAt, true)}${r.late ? ' (late)' : ''}` : '—'}</Td><Td className="tabular-nums">{r.band ?? 'Not graded'}</Td></tr>
          ))}
        </Table>
      ))}
      {q.isLoading && <SkeletonTable rows={4} cols={4} />}
    </>
  );
}
