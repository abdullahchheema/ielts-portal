'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Badge, Empty, PageHeader, Section, SimpleList, SimpleListItem, SkeletonCards, StatCard, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { date } from '@/lib/format';

interface Metric { key: string; label: string; value: number; href: string; attention: boolean }
interface Center {
  metrics: Metric[];
  batchHealth?: { batch: string; status: string; reasons: string[] }[];
  riskDistribution?: Record<string, number>;
  enrolmentTrend?: { week: string; count: number }[];
  recentActivity?: { action: string; entityType: string; createdAt: string }[];
  alerts?: { level: 'RED' | 'YELLOW'; message: string }[];
}

/** What needs intervention first. Every number links to the screen where it is handled. */
export default function AdminHome() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['command-center'], queryFn: () => api<Center>('/admin/command-center'), refetchInterval: 120_000 });
  return (
    <>
      <PageHeader title="Command centre" subtitle="What needs intervention, in order of urgency." />
      {isLoading && <SkeletonCards count={4} />}
      {isError && <Alert>Could not load the command centre.</Alert>}
      {data && (
        <div className="space-y-8">
          {data.alerts && data.alerts.length > 0 && (
            <Section title="System alerts">
              <ul className="space-y-2">
                {data.alerts.map((a, i) => (
                  <li key={i}><Alert kind={a.level === 'RED' ? 'error' : 'warning'}>{a.message}</Alert></li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Needs attention">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {data.metrics.map((m) => (
                <StatCard key={m.key} label={m.label} value={m.value} href={m.href} attention={m.attention} />
              ))}
            </div>
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            {data.batchHealth && (
              <Section title="Batch health">
                {data.batchHealth.length === 0 ? <Empty>No open batches.</Empty> : (
                  <SimpleList>
                    {data.batchHealth.map((b) => (
                      <SimpleListItem
                        key={b.batch}
                        left={
                          <div className="min-w-0">
                            <p className="font-medium text-fg">{b.batch}</p>
                            {b.reasons.length > 0 && <p className="text-xs text-fg-muted">{b.reasons.join(' · ')}</p>}
                          </div>
                        }
                        right={<Badge status={b.status === 'RED' ? 'RED' : b.status === 'YELLOW' ? 'AMBER' : 'GREEN'} text={b.status.toLowerCase()} />}
                      />
                    ))}
                  </SimpleList>
                )}
              </Section>
            )}
            {data.riskDistribution && (
              <Section title="Student risk" actions={<Link href="/admin/engagement" className="text-sm font-medium text-primary hover:underline">Open engagement</Link>}>
                <SimpleList>
                  {Object.entries(data.riskDistribution).map(([k, v]) => (
                    <SimpleListItem key={k} left={<span className="text-fg-muted">{k.replace('_', ' ').toLowerCase()}</span>} right={<span className="font-medium tabular-nums text-fg">{v}</span>} />
                  ))}
                </SimpleList>
              </Section>
            )}
          </div>

          {data.recentActivity && (
            <Section title="Recent activity">
              {data.recentActivity.length === 0 ? <Empty>Nothing recorded yet.</Empty> : (
                <Table head={['When', 'Action', 'Record']} sticky>
                  {data.recentActivity.map((a, i) => (
                    <tr key={i}><Td>{date(a.createdAt)}</Td><Td className="font-mono text-xs">{a.action}</Td><Td>{a.entityType}</Td></tr>
                  ))}
                </Table>
              )}
            </Section>
          )}
        </div>
      )}
    </>
  );
}
