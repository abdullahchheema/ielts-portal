'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Empty, Loading, PageHeader, Tabs, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

interface Board {
  batch: string | null; period: 'WEEKLY' | 'MONTHLY';
  top: { rank: number; name: string; points: number }[];
  me: { rank: number; points: number } | null;
  note: string;
}

/** Your batch's weekly and monthly leaderboards, based on academic activity. You can leave the public ranking. */
export default function LeaderboardPage() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<'WEEKLY' | 'MONTHLY'>('WEEKLY');
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({ queryKey: ['leaderboard', period], queryFn: () => api<Board>(`/me/leaderboard?type=${period}`) });

  async function optOut(v: boolean) {
    setError(null);
    try {
      await api('/me/leaderboard/opt-out', { method: 'POST', body: { optOut: v } });
      await qc.invalidateQueries({ queryKey: ['leaderboard'] });
    } catch (e) { setError(errorMessage(e)); }
  }

  return (
    <>
      <PageHeader title="Leaderboard" subtitle="Your batch, ranked by practice, mocks, attendance, assignments and improvement." />
      {error && <Alert>{error}</Alert>}
      {isLoading && <Loading />}
      {isError && <Alert>Could not load the leaderboard.</Alert>}
      {data && !data.batch && <Empty title="No batch yet">Enrol in a batch to see its leaderboard.</Empty>}
      {data && data.batch && (
        <div className="space-y-6">
          <Tabs aria-label="Period" value={period} onChange={(k) => setPeriod(k as 'WEEKLY' | 'MONTHLY')} items={[{ key: 'WEEKLY', label: 'This week' }, { key: 'MONTHLY', label: 'This month' }]} />
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">{data.me ? `You are ranked ${data.me.rank} with ${data.me.points} points.` : 'You are not shown in the ranking.'}</p>
            {data.me ? <Button variant="secondary" onClick={() => optOut(true)}>Hide me from the ranking</Button> : <Button variant="secondary" onClick={() => optOut(false)}>Show me in the ranking</Button>}
          </Card>
          {data.top.length === 0 ? <Empty title="No activity yet this period" /> : (
            <Table head={['Rank', 'Student', 'Points']}>
              {data.top.map((e) => <tr key={e.rank}><Td className="tabular-nums">{e.rank}</Td><Td>{e.name}</Td><Td className="tabular-nums">{e.points}</Td></tr>)}
            </Table>
          )}
          <p className="text-xs text-fg-subtle">{data.note}</p>
        </div>
      )}
    </>
  );
}
