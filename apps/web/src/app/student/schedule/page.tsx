'use client';

import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Card, CardList, CardListItem, Empty, Loading, PageHeader, ProgressBar, Section, SimpleList, SimpleListItem } from '@/components/ui';
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
        <CardList>
          {sessions.data.upcoming.map((s) => (
            <CardListItem key={s.id}
              left={<div><p className="font-semibold">{s.topic}</p><p className="text-sm text-fg-muted">{date(s.startsAt, true)} – {new Date(s.endsAt).toLocaleTimeString('en-GB', { timeStyle: 'short' })} · {s.course} ({s.batch})</p></div>}
              right={s.joinUrl ? <a href={s.joinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md bg-success px-4 py-2 text-sm font-medium text-white hover:brightness-95">Join class ↗</a> : <span className="text-sm text-fg-muted">Link opens 15 min before</span>}
            />
          ))}
        </CardList>
      )}

      {att.data && att.data.some((a) => a.sessionsHeld > 0) && (
        <Section title="My attendance" className="mt-8">
          <div className="grid gap-4 md:grid-cols-2">
            {att.data.filter((a) => a.sessionsHeld > 0).map((a) => (
              <Card key={a.enrollmentId}><p className="mb-2 font-medium">{a.course}</p>
                <ProgressBar value={a.attendancePercent ?? 0} label={`Attended ${a.present + a.late} of ${a.sessionsHeld} classes`} />
                <p className="mt-2 text-xs text-fg-muted">{a.present} present · {a.late} late · {a.absent} absent · {a.excused} excused</p>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {sessions.data.past.length > 0 && (
        <Section title="Past classes" className="mt-8">
          <SimpleList>
            {sessions.data.past.map((s) => (
              <SimpleListItem key={s.id}
                left={<span><strong>{s.topic}</strong> <span className="text-fg-muted">· {date(s.startsAt, true)}</span></span>}
                right={<>{s.attendance && <Badge status={s.attendance} />}{s.recordingUrl && <a href={s.recordingUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">Recording ↗</a>}</>}
              />
            ))}
          </SimpleList>
        </Section>
      )}
    </>
  );
}
