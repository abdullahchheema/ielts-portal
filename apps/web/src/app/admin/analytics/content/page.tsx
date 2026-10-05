'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Alert, Badge, Empty, FilterBar, PageHeader, Section, Select, SkeletonTable, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { useUrlState } from '@/lib/url-state';
import { label } from '@/lib/format';

interface CourseSummary { id: string; title: string; versions: { id: string; versionNumber: number; status: string }[] }
interface AssessmentSummary { id: string; title: string }
interface ItemRow { itemId: string; section: string; title: string; contentType: string; started: number; completed: number; completionPercent: number | null }
interface CourseItems { cohortSize: number; items: ItemRow[] }
interface QuestionRow { questionVersionId: string; type: string; prompt: string; attempts: number; correct: number; correctPercent: number | null; discrimination: number | null }
interface QuestionAnalysis { title: string; questions: QuestionRow[] }

/** Where students drop off in the course, and which questions need review. Content-quality figures, not judgements of students. */
export default function ContentAnalyticsPage() {
  const defaults = useMemo(() => ({ version: '', assessment: '' }), []);
  const [filters, setFilters] = useUrlState(defaults);

  const courses = useQuery({ queryKey: ['content-courses'], queryFn: () => api<CourseSummary[]>('/admin/courses') });
  const assessments = useQuery({ queryKey: ['content-assessments'], queryFn: () => api<AssessmentSummary[]>('/admin/assessments') });
  const versionOptions = (courses.data ?? []).flatMap((c) => c.versions.map((v) => ({ id: v.id, label: `${c.title} · v${v.versionNumber} (${label(v.status)})` })));
  const versionId = filters.version || versionOptions[0]?.id || '';
  const assessmentId = filters.assessment || assessments.data?.[0]?.id || '';

  const items = useQuery({ queryKey: ['content-items', versionId], queryFn: () => api<CourseItems>(`/admin/analytics/courses/${versionId}`), enabled: !!versionId });
  const questions = useQuery({ queryKey: ['content-questions', assessmentId], queryFn: () => api<QuestionAnalysis>(`/admin/analytics/questions?assessmentId=${assessmentId}`), enabled: !!assessmentId });

  return (
    <>
      <PageHeader title="Course and question analytics" subtitle="Where students stop, and which questions need a second look. These describe the content, not individual students." breadcrumbs={[{ href: '/admin/analytics', label: 'Analytics' }, { label: 'Content' }]} />

      <Section title="Course items" description="How many students started and finished each item, across the current cohort.">
        <FilterBar>
          <Select aria-label="Course version" className="!w-auto" value={versionId} onChange={(e) => setFilters({ version: e.target.value })}>
            {versionOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Select>
          {items.data && <span className="text-sm text-fg-muted">{items.data.cohortSize} students on this version</span>}
        </FilterBar>
        {items.isLoading ? <SkeletonTable rows={6} cols={5} /> : items.isError || !items.data ? <Alert>Could not load course analytics.</Alert> : items.data.items.length === 0 ? (
          <Empty title="No items yet">Add lessons to this course version to see how students progress through them.</Empty>
        ) : (
          <Table head={['Section', 'Item', 'Type', 'Started', 'Completed', 'Completion']}>
            {items.data.items.map((r) => (
              <tr key={r.itemId}>
                <Td className="text-fg-muted">{r.section}</Td>
                <Td className="font-medium">{r.title}</Td>
                <Td>{label(r.contentType)}</Td>
                <Td className="tabular-nums">{r.started}</Td>
                <Td className="tabular-nums">{r.completed}</Td>
                <Td>
                  {r.completionPercent === null ? <span className="text-fg-muted">Not enough data</span> : (
                    <Badge status={r.completionPercent < 50 ? "LOW" : r.completionPercent < 75 ? "MEDIUM" : "HIGH"} tone={r.completionPercent < 50 ? 'red' : r.completionPercent < 75 ? 'amber' : 'green'} text={`${r.completionPercent}%`} />
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Question analysis" description="Success rate and discrimination for each question in the latest version. Discrimination shows whether stronger students get a question right more often than weaker ones.">
        <FilterBar>
          <Select aria-label="Assessment" className="!w-auto" value={assessmentId} onChange={(e) => setFilters({ assessment: e.target.value })}>
            {(assessments.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </Select>
        </FilterBar>
        {questions.isLoading ? <SkeletonTable rows={6} cols={5} /> : questions.isError || !questions.data ? <Alert>Could not load question analysis.</Alert> : questions.data.questions.length === 0 ? (
          <Empty title="No questions yet">Questions appear here once this assessment has them.</Empty>
        ) : (
          <Table head={['Question', 'Type', 'Attempts', 'Correct', 'Discrimination', 'Review']}>
            {questions.data.questions.map((q) => {
              const flags: string[] = [];
              if (q.correctPercent !== null && q.correctPercent >= 90) flags.push('Very easy');
              if (q.correctPercent !== null && q.correctPercent <= 20) flags.push('Very hard');
              if (q.discrimination !== null && q.discrimination < 0.2) flags.push('Weak separation');
              return (
                <tr key={q.questionVersionId}>
                  <Td className="max-w-md">{q.prompt || 'Untitled question'}</Td>
                  <Td>{label(q.type)}</Td>
                  <Td className="tabular-nums">{q.attempts}</Td>
                  <Td className="tabular-nums">{q.correctPercent === null ? 'Not enough data' : `${q.correctPercent}%`}</Td>
                  <Td className="tabular-nums">{q.discrimination === null ? 'Not enough data' : q.discrimination.toFixed(2)}</Td>
                  <Td>{flags.length ? <span className="text-sm text-danger">{flags.join(', ')}</span> : <span className="text-sm text-fg-muted">Looks sound</span>}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>
    </>
  );
}
