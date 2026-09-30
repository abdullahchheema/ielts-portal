'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Empty, Input, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { date } from '@/lib/format';

interface Entry { id: string; createdAt: string; action: string; entityType: string; entityId: string | null; actor: string | null; ip: string | null; before: unknown; after: unknown }
interface Page { items: Entry[]; nextBefore: string | null }

export default function AuditPage() {
  const [action, setAction] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['audit', action],
    initialPageParam: '' as string,
    queryFn: ({ pageParam }) => api<Page>(`/admin/audit-logs?take=50${action ? `&action=${encodeURIComponent(action)}` : ''}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only. Entries cannot be edited or deleted." />
      <div className="mb-4 max-w-xs"><Input aria-label="Filter by action" placeholder="Action, e.g. ADMIN_APPROVED_PAYMENT" value={action} onChange={(e) => setAction(e.target.value.trim().toUpperCase())} /></div>
      {q.isLoading && <Loading />}
      {q.isError && <Alert>Could not load the audit log.</Alert>}
      {q.data && (rows.length === 0 ? <Empty>No entries.</Empty> : (
        <>
          <Table head={['When', 'Actor', 'Action', 'Entity', 'Details']}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">{date(r.createdAt, true)}</Td>
                <Td>{r.actor ?? 'system'}<span className="block text-xs text-slate-500">{r.ip}</span></Td>
                <Td className="font-mono text-xs">{r.action}</Td>
                <Td>{r.entityType}<span className="block font-mono text-xs text-slate-500">{r.entityId?.slice(0, 8)}</span></Td>
                <Td>{(r.before || r.after) ? (
                  <details><summary className="cursor-pointer text-indigo-700">View</summary>
                    <pre className="mt-1 max-h-48 max-w-md overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify({ before: r.before, after: r.after }, null, 2)}</pre>
                  </details>) : '—'}</Td>
              </tr>
            ))}
          </Table>
          {q.hasNextPage && <div className="mt-4 text-center"><Button variant="secondary" busy={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Load more</Button></div>}
        </>
      ))}
    </>
  );
}
