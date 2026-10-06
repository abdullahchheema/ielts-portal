'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Loading, PageHeader, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import { date, money } from '@/lib/format';

interface Mine {
  code: string;
  link: string;
  balance: string;
  counts: { total: number; pending: number; successful: number; rewarded: number; rejected: number };
  items: { id: string; status: string; name: string; createdAt: string; enrolledAt: string | null; rewardedAt: string | null }[];
}

const STEPS = ['REGISTERED', 'APPLIED', 'ENROLLED', 'QUALIFIED', 'REWARDED'];

export default function StudentReferralsPage() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['my-referrals'], queryFn: () => api<Mine>('/me/referrals') });
  const [copied, setCopied] = useState(false);

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked: the link is still visible to copy by hand */ }
  }

  return (
    <>
      <PageHeader title="My referrals" subtitle="Invite a friend. When they enrol and finish their first weeks, your reward is added here." />
      {isLoading && <Loading />}
      {isError && <Alert>Could not load your referrals. <button className="underline" onClick={() => refetch()}>Try again</button></Alert>}
      {data && (
        <div className="space-y-6">
          <Card className="space-y-3">
            <p className="text-sm text-fg-muted">Your referral link</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 truncate rounded-md bg-surface-muted px-3 py-2 text-sm">{data.link}</code>
              <Button variant="secondary" onClick={() => copy(data.link)}>{copied ? 'Copied' : 'Copy link'}</Button>
            </div>
            <p className="text-xs text-fg-subtle">Your code: <span className="font-mono font-medium text-fg">{data.code}</span></p>
          </Card>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Pending" value={data.counts.pending} hint="Signed up or enrolling" />
            <StatCard label="Successful" value={data.counts.successful} hint="Qualified or rewarded" />
            <StatCard label="Rewarded" value={data.counts.rewarded} />
            <StatCard label="Reward balance" value={money(data.balance)} hint="Account credit" />
          </div>

          <section>
            <h2 className="mb-3 font-semibold text-fg">Your referrals</h2>
            {data.items.length === 0 ? <Empty title="No referrals yet">Share your link. A referral appears here once a friend registers with it.</Empty> : (
              <ul className="space-y-2">
                {data.items.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-fg">{r.name}</p>
                      <p className="text-xs text-fg-subtle">Joined {date(r.createdAt)}{r.enrolledAt ? ` · enrolled ${date(r.enrolledAt)}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <ol className="flex gap-1 text-[10px] uppercase tracking-wide text-fg-subtle" aria-label="Progress">
                        {STEPS.map((s, i) => <li key={s} className={STEPS.indexOf(r.status) >= i ? 'font-semibold text-primary' : ''}>{i + 1}</li>)}
                      </ol>
                      <Badge status={r.status === 'REWARDED' ? 'ACTIVE' : r.status} text={r.status === 'REWARDED' ? 'Rewarded' : r.status.toLowerCase()} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}
