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
      <div className="mb-8 grid gap-4 md:grid-cols-2">
        {(['LISTENING', 'READING', 'WRITING', 'SPEAKING'] as const).map((k) => (
          <BandChart key={k} skill={k[0] + k.slice(1).toLowerCase()} points={skills.data[k].series} target={target} />
        ))}
      </div>

      {subs.data && subs.data.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-semibold">Writing & speaking submissions</h2>
          <ul className="divide-y divide-slate-100 rounded-lg bg-white ring-1 ring-slate-200">
            {subs.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span><strong>{s.title}</strong> <span className="text-slate-500">· {date(s.submittedAt)}</span></span>
                <span className="flex items-center gap-3">{s.finalBand !== null && <strong>Band {band(s.finalBand)}</strong>}<Badge status={s.status} /><Link href={`/student/submissions/${s.id}`} className="text-indigo-700 underline">Open</Link></span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
