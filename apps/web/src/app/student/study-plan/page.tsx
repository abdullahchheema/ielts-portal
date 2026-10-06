'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Empty, Loading, PageHeader, Tabs } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

type View = 'today' | 'week' | 'upcoming' | 'completed' | 'overdue';
interface Task { id: string; title: string; skill: string; minutes: number; status: string; rationale: string; date: string; completedAt: string | null }
interface Plan {
  plan: { id: string; status: string; summary: string; minutesPerDay: number; generatedAt: string } | null;
  view: View; today: string; tasks: Task[]; counts: Record<View, number>; minutesToday: number;
}

const PLAN_LABEL: Record<string, string> = { ON_TRACK: 'On track', NEEDS_IMPROVEMENT: 'Needs improvement', NO_TARGET: 'No target set', NO_EXAM_DATE: 'No exam date' };
const VIEWS: { key: View; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: 'week', label: 'This week' }, { key: 'upcoming', label: 'Upcoming' }, { key: 'overdue', label: 'Overdue' }, { key: 'completed', label: 'Completed' },
];

/** Your study plan. Each task is a real lesson, question set, writing or speaking prompt, or vocabulary review. */
export default function StudyPlanPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<View>('today');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, isLoading, isError } = useQuery({ queryKey: ['study-plan', view], queryFn: () => api<Plan>(`/me/study-plan?view=${view}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['study-plan'] });

  async function complete(id: string) {
    setError(null);
    try { await api(`/me/study-plan/tasks/${id}/complete`, { method: 'POST' }); await refresh(); }
    catch (e) { setError(errorMessage(e)); }
  }
  async function recalc() {
    setBusy(true); setError(null);
    try { await api('/me/study-plan/recalculate', { method: 'POST' }); await refresh(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader
        title="Study plan"
        subtitle={data?.plan?.summary ?? 'Set a target band and exam date to get a plan built from your results.'}
        actions={<Button variant="secondary" onClick={recalc} busy={busy}>Update plan</Button>}
      />
      {error && <Alert>{error}</Alert>}
      {isLoading && <Loading />}
      {isError && <Alert>Could not load your plan.</Alert>}

      {data && (
        <>
          {data.plan && (
            <p className="mb-4 text-sm text-fg-muted">
              {PLAN_LABEL[data.plan.status] ?? data.plan.status} · {data.plan.minutesPerDay} minutes a day
            </p>
          )}
          <Tabs
            aria-label="Plan views"
            value={view}
            onChange={(v) => setView(v as View)}
            items={VIEWS.map((v) => ({ key: v.key, label: v.label, count: data.counts[v.key] || undefined }))}
          />
          <div className="mt-6">
            {!data.plan && <Empty title="No plan yet">Set a target band and exam date in your profile, then update the plan.</Empty>}
            {data.plan && data.tasks.length === 0 && <Empty title={`Nothing in ${VIEWS.find((v) => v.key === view)?.label.toLowerCase()}`}>{view === 'completed' ? 'Completed tasks appear here.' : 'You are all caught up.'}</Empty>}
            <ul className="space-y-3">
              {data.tasks.map((t) => (
                <li key={t.id}>
                  <Card className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-fg">{t.title}</p>
                      <p className="text-xs text-fg-muted">{t.skill.toLowerCase()} · {t.minutes} min · {t.date}</p>
                      <p className="mt-1 text-sm text-fg-muted">{t.rationale}</p>
                    </div>
                    {t.status === 'PENDING' ? <Button variant="secondary" onClick={() => complete(t.id)}>Mark done</Button> : <span className="text-sm text-success">Done</span>}
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
