'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, ProgressRing, SkeletonCards, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { band, date } from '@/lib/format';

export interface Home {
  greetingName: string;
  target: number | null;
  estimated: number | null;
  examDate: string | null;
  daysRemaining: number | null;
  readiness: { percent: number; label: string; reasons: string[] };
  weakAreas: { key: string; level: string; accuracy: number | null; total: number }[];
  pendingWork: number;
  nextClass: { id: string; topic: string; startsAt: string } | null;
  recentPerformance: { id: string; title: string; skill: string | null; band: number; at: string | null }[];
  mockHistory: { id: string; title: string; band: number; at: string | null }[];
  streakDays: number;
}

interface PlanTask { id: string; title: string; minutes: number; skill: string; rationale: string }
interface Plan { plan: { id: string; status: string; summary: string } | null; tasks: PlanTask[]; minutesToday: number }

const LEVEL: Record<string, string> = { HIGH_RISK: 'High risk', NEEDS_PRACTICE: 'Needs practice', STRONG: 'Strong', INSUFFICIENT_DATA: 'Not enough data' };

/** Top of the student dashboard: where you are, your level, your target, the time left, and readiness. */
export function HomeHero({ home }: { home: Home }) {
  const countdown = home.daysRemaining === null ? 'No exam date' : home.daysRemaining < 0 ? 'Exam date passed' : `${home.daysRemaining} days`;
  return (
    <section aria-label="Your progress" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Target band" value={band(home.target === null ? null : String(home.target))} hint="Your goal" />
      <StatCard label="Estimated now" value={home.estimated === null ? '—' : band(String(home.estimated))} hint="Latest estimate" />
      <StatCard label="Exam" value={countdown} hint={home.examDate ? date(home.examDate) : 'Set your exam date in your profile'} />
      <Card className="flex items-center gap-4">
        <ProgressRing value={home.readiness.percent} size={64} label="Readiness estimate" />
        <div>
          <p className="text-sm font-medium text-fg-muted">Readiness estimate</p>
          <p className="text-xs text-fg-subtle">A guide to your preparation, not a guarantee of a band.</p>
        </div>
      </Card>
    </section>
  );
}

/** Today's study tasks, with a one-tap way to mark each one done. */
export function TodaysPlan() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['plan-today'], queryFn: () => api<Plan>('/me/study-plan?view=today') });
  const [error, setError] = useState<string | null>(null);

  async function done(id: string) {
    setError(null);
    try {
      await api(`/me/study-plan/tasks/${id}/complete`, { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['plan-today'] });
    } catch (e) { setError(errorMessage(e)); }
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-fg">Today’s plan</h2>
        <Link href="/student/study-plan" className="text-sm font-medium text-primary hover:underline">Full plan</Link>
      </div>
      {isLoading && <SkeletonCards count={1} />}
      {isError && <Alert>Could not load today’s plan.</Alert>}
      {error && <Alert>{error}</Alert>}
      {data && !data.plan && <Empty title="No plan yet">Set a target band and exam date to get a plan.</Empty>}
      {data?.plan && data.tasks.length === 0 && <p className="text-sm text-fg-muted">Nothing is due today. Enjoy the time.</p>}
      {data?.plan && data.tasks.length > 0 && (
        <>
          <p className="text-sm text-fg-muted">About {data.minutesToday} minutes today.</p>
          <ul className="space-y-2">
            {data.tasks.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">{t.title}</p>
                  <p className="text-xs text-fg-muted">{t.skill.toLowerCase()} · {t.minutes} min · {t.rationale}</p>
                </div>
                <Button variant="secondary" className="!py-1" onClick={() => done(t.id)}>Done</Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/** Weak areas, recent results, mock history and the study streak, in one row of cards. */
export function HomeInsights({ home }: { home: Home }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
      <Card className="space-y-2">
        <h3 className="font-semibold text-fg">Weak areas</h3>
        {home.weakAreas.length === 0
          ? <p className="text-sm text-fg-muted">Nothing is flagged yet. Keep practising.</p>
          : <ul className="space-y-2">{home.weakAreas.map((w) => <li key={w.key} className="flex items-center justify-between text-sm"><span className="text-fg">{w.key.replace(/_/g, ' ').toLowerCase()}</span><Badge status={w.level} text={LEVEL[w.level] ?? w.level} /></li>)}</ul>}
        <Link href="/student/insights" className="text-sm font-medium text-primary hover:underline">See the breakdown</Link>
      </Card>
      <Card className="space-y-2">
        <h3 className="font-semibold text-fg">Recent performance</h3>
        {home.recentPerformance.length === 0
          ? <p className="text-sm text-fg-muted">Your results will appear here.</p>
          : <ul className="space-y-1 text-sm">{home.recentPerformance.slice(0, 4).map((r) => <li key={r.id} className="flex justify-between gap-2"><span className="truncate text-fg-muted">{r.title}</span><span className="tabular-nums text-fg">{band(String(r.band))}</span></li>)}</ul>}
      </Card>
      <Card className="space-y-2">
        <h3 className="font-semibold text-fg">Mock history</h3>
        {home.mockHistory.length === 0
          ? <p className="text-sm text-fg-muted">No mock tests yet.</p>
          : <ul className="space-y-1 text-sm">{home.mockHistory.map((m) => <li key={m.id} className="flex justify-between gap-2"><span className="truncate text-fg-muted">{m.title}</span><span className="tabular-nums text-fg">{band(String(m.band))}</span></li>)}</ul>}
        <Link href="/student/simulator" className="text-sm font-medium text-primary hover:underline">Open the simulator</Link>
      </Card>
      <Card className="space-y-2">
        <h3 className="font-semibold text-fg">Study streak</h3>
        <p className="font-display text-3xl font-semibold tabular-nums text-fg">{home.streakDays}</p>
        <p className="text-sm text-fg-muted">{home.streakDays === 1 ? 'day in a row' : 'days in a row'}{home.pendingWork > 0 ? ` · ${home.pendingWork} assignment${home.pendingWork === 1 ? '' : 's'} to submit` : ''}</p>
      </Card>
    </div>
  );
}
