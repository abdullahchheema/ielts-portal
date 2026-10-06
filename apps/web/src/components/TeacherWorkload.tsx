'use client';

import { useQuery } from '@tanstack/react-query';
import { Alert, Section, SkeletonCards, StatCard } from '@/components/ui';
import { api } from '@/lib/api';

interface Summary {
  pendingGrading: { writing: number; speaking: number; total: number };
  overdueGrading: number;
  todayClasses: number;
  studentsAtRisk: number;
  openFollowUps: number;
  targetHours: number;
}

/** What needs the teacher's attention today. Counts only cover the teacher's assigned batches. */
export function TeacherWorkload() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['teacher-summary'], queryFn: () => api<Summary>('/mentor/workspace/summary'), refetchInterval: 120_000 });
  return (
    <Section title="Today" description="Only your assigned batches are counted.">
      {isLoading && <SkeletonCards count={4} />}
      {isError && <Alert>Could not load your workload.</Alert>}
      {data && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Writing to mark" value={data.pendingGrading.writing} href="/teacher/grading" attention={data.pendingGrading.writing > 0} />
          <StatCard label="Speaking to mark" value={data.pendingGrading.speaking} href="/teacher/grading" attention={data.pendingGrading.speaking > 0} />
          <StatCard label={`Over ${data.targetHours}h`} value={data.overdueGrading} hint="Past the target turnaround" attention={data.overdueGrading > 0} />
          <StatCard label="Classes today" value={data.todayClasses} href="/teacher/batches" />
          <StatCard label="Students at risk" value={data.studentsAtRisk} hint={`${data.openFollowUps} follow-ups open`} attention={data.studentsAtRisk > 0} />
        </div>
      )}
    </Section>
  );
}
