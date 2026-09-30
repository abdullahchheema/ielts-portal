'use client';

import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Card, Empty, Loading, PageHeader, ProgressBar } from '@/components/ui';
import { api } from '@/lib/api';
import { date } from '@/lib/format';

interface Session { id: string; topic: string; startsAt: string; endsAt: string; provider: string | null; batch: string; course: string; joinUrl: string | null; recordingUrl: string | null; attendance: string | null }
interface Att { enrollmentId: string; course: string; sessionsHeld: number; present: number; late: number; absent: number; excused: number; attendancePercent: number | null }

export default function SchedulePage() {
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ upcoming: Session[]; past: Session[] }>('/me/sessions'), refetchInterval: 60_000 });
  const att = useQuery({ queryKey: ['attendance'], queryFn: () => api<Att[]>('/me/attendance') });
  if (sessions.isLoading) return <Loading />;
  if (sessions.isError || !sessions.data) return <Alert>Could not load your schedule.</Alert>;

  return (
    <>
      <PageHeader title="Live classes" subtitle="The join link appears 15 minutes before a class starts." />
      {sessions.data.upcoming.length === 0 ? <Empty>No upcoming classes scheduled.</Empty> : (
        <ul className="space-y-3">
          {sessions.data.upcoming.map((s) => (
            <li key={s.id}><Card className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="font-semibold">{s.topic}</p><p className="text-sm text-slate-600">{date(s.startsAt, true)} – {new Date(s.endsAt).toLocaleTimeString('en-GB', { timeStyle: 'short' })} · {s.course} ({s.batch})</p></div>
              {s.joinUrl ? <a href={s.joinUrl} target="_blank" rel="noopener noreferrer" className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">Join class ↗</a> : <span className="text-sm text-slate-500">Link opens 15 min before</span>}
            </Card></li>
          ))}
        </ul>
      )}

      {att.data && att.data.some((a) => a.sessionsHeld > 0) && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-semibold">My attendance</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {att.data.filter((a) => a.sessionsHeld > 0).map((a) => (
              <Card key={a.enrollmentId}><p className="mb-2 font-medium">{a.course}</p>
                <ProgressBar value={a.attendancePercent ?? 0} label={`Attended ${a.present + a.late} of ${a.sessionsHeld} classes`} />
                <p className="mt-2 text-xs text-slate-500">{a.present} present · {a.late} late · {a.absent} absent · {a.excused} excused</p>
              </Card>
            ))}
          </div>
        </>
      )}

      {sessions.data.past.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-semibold">Past classes</h2>
          <ul className="divide-y divide-slate-100 rounded-lg bg-white ring-1 ring-slate-200">
            {sessions.data.past.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span><strong>{s.topic}</strong> <span className="text-slate-500">· {date(s.startsAt, true)}</span></span>
                <span className="flex items-center gap-3">{s.attendance && <Badge status={s.attendance} />}{s.recordingUrl && <a href={s.recordingUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline">Recording ↗</a>}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
