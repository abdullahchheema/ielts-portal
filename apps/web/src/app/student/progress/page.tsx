'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Badge, Loading, PageHeader, Section, SimpleList, SimpleListItem } from '@/components/ui';
import { BandChart, BandPoint } from '@/components/BandChart';
import { api } from '@/lib/api';
import { band, date, label } from '@/lib/format';

type Skills = Record<'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING', { latest: number | null; best: number | null; series: BandPoint[] }>;
interface Sub { id: string; title: string; skill: string; status: string; submittedAt: string; finalBand: number | null }
type SkillState = 'UNKNOWN' | 'WEAK' | 'DEVELOPING' | 'STRONG' | 'MASTERED' | 'NEEDS_REVIEW';
interface SkillStateRow { skillKey: string; module: string | null; state: SkillState; accuracyPercent: string | number | null; sampleSize: number; lastEvidenceAt: string | null; reviewDueAt: string | null }

const STATE_TONE: Record<SkillState, 'green' | 'blue' | 'amber' | 'red' | 'slate'> = {
  MASTERED: 'green', STRONG: 'blue', DEVELOPING: 'amber', WEAK: 'red', NEEDS_REVIEW: 'amber', UNKNOWN: 'slate',
};

function SkillBreakdown({ states }: { states: SkillStateRow[] }) {
  const evidenced = states.filter((s) => s.sampleSize > 0);
  if (evidenced.length === 0) return <p className="text-sm text-slate-500">Complete some graded practice or a mock test to see a question-type breakdown here.</p>;
  const byModule = new Map<string, SkillStateRow[]>();
  for (const s of evidenced) {
    const m = s.module ?? 'GENERAL';
    if (!byModule.has(m)) byModule.set(m, []);
    byModule.get(m)!.push(s);
  }
  return (
    <div className="space-y-5">
      {[...byModule.entries()].map(([module, rows]) => (
        <div key={module}>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">{label(module)}</h3>
          <ul className="divide-y divide-slate-100 rounded-lg bg-white ring-1 ring-slate-200">
            {rows.sort((a, b) => a.skillKey.localeCompare(b.skillKey)).map((s) => (
              <li key={s.skillKey} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span>{label(s.skillKey)}</span>
                <span className="flex items-center gap-3 text-slate-600">
                  <span>{Math.round(Number(s.accuracyPercent ?? 0))}% · {s.sampleSize} question{s.sampleSize === 1 ? '' : 's'}</span>
                  <Badge status={s.state} tone={STATE_TONE[s.state]} text={label(s.state)} />
                  {s.reviewDueAt && new Date(s.reviewDueAt) <= new Date() && <Badge status="REVIEW_DUE" tone="amber" text="Review due" />}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function ProgressPage() {
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => api<Skills>('/me/skills') });
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api<{ targetBand: string | null }>('/me/profile') });
  const subs = useQuery({ queryKey: ['submissions'], queryFn: () => api<Sub[]>('/me/submissions') });
  const skillStates = useQuery({ queryKey: ['skill-states'], queryFn: () => api<SkillStateRow[]>('/me/skill-states') });

  if (skills.isLoading) return <Loading />;
  if (skills.isError || !skills.data) return <Alert>Could not load your progress.</Alert>;
  const target = profile.data?.targetBand ? Number(profile.data.targetBand) : null;

  return (
    <>
      <PageHeader title="My progress" subtitle="Your band scores by skill over time, from mock tests, practice and teacher-graded work." />
      <div className="mb-8 grid gap-5 md:grid-cols-2">
        {(['LISTENING', 'READING', 'WRITING', 'SPEAKING'] as const).map((k) => (
          <BandChart key={k} skill={k[0] + k.slice(1).toLowerCase()} points={skills.data[k].series} target={target} />
        ))}
      </div>

      <h2 className="mb-3 text-lg font-semibold">Question-type breakdown</h2>
      <p className="mb-3 text-sm text-slate-500">Accuracy and mastery by skill area, computed from your actual graded answers — a skill with no evidence yet is left out rather than guessed at.</p>
      <div className="mb-8">
        {skillStates.isLoading ? <Loading /> : skillStates.isError || !skillStates.data ? <Alert>Could not load the breakdown.</Alert> : <SkillBreakdown states={skillStates.data} />}
      </div>

      {subs.data && subs.data.length > 0 && (
        <Section title="Writing & speaking submissions" className="mt-10">
          <SimpleList>
            {subs.data.map((s) => (
              <SimpleListItem key={s.id}
                left={<span><strong>{s.title}</strong> <span className="text-fg-muted tabular-nums">· {date(s.submittedAt)}</span></span>}
                right={<>{s.finalBand !== null && <strong>Band {band(s.finalBand)}</strong>}<Badge status={s.status} /><Link href={`/student/submissions/${s.id}`} className="font-medium text-primary underline underline-offset-2">Open</Link></>}
              />
            ))}
          </SimpleList>
        </Section>
      )}
    </>
  );
}
