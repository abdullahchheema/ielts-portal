'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Badge, Loading, PageHeader } from '@/components/ui';
import { BandChart, BandPoint } from '@/components/BandChart';
import { api } from '@/lib/api';
import { band, date } from '@/lib/format';

type Skills = Record<'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING', { latest: number | null; best: number | null; series: BandPoint[] }>;
interface Sub { id: string; title: string; skill: string; status: string; submittedAt: string; finalBand: number | null }

export default function ProgressPage() {
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => api<Skills>('/me/skills') });
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api<{ targetBand: string | null }>('/me/profile') });
  const subs = useQuery({ queryKey: ['submissions'], queryFn: () => api<Sub[]>('/me/submissions') });

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

      {subs.data && subs.data.length > 0 && (
        <>
          <h2 className="mb-3 mt-10 font-display text-lg font-semibold text-fg">Writing & speaking submissions</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg bg-surface shadow-xs ring-1 ring-border">
            {subs.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span><strong>{s.title}</strong> <span className="text-fg-muted tabular-nums">· {date(s.submittedAt)}</span></span>
                <span className="flex items-center gap-3">{s.finalBand !== null && <strong>Band {band(s.finalBand)}</strong>}<Badge status={s.status} /><Link href={`/student/submissions/${s.id}`} className="font-medium text-primary underline underline-offset-2">Open</Link></span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
