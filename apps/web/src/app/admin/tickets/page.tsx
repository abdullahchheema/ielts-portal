'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, ClickableRow, Empty, FilterBar, Loading, PageHeader, Pagination, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { date, label } from '@/lib/format';

interface Row { id: string; subject: string; category: string; priority: string; status: string; createdAt: string; student: string; email: string; messages: number }

const TAKE = 25;

export default function TicketsPage() {
  const router = useRouter();
  const me = useMe();
  const [status, setStatus] = useState('OPEN');
  const [assignee, setAssignee] = useState<'' | 'me'>('');
  const [skip, setSkip] = useState(0);
  const params = new URLSearchParams({ skip: String(skip), take: String(TAKE) });
  if (status) params.set('status', status);
  if (assignee === 'me' && me.data) params.set('assignedTo', me.data.id);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-tickets', status, assignee, skip],
    queryFn: () => api<{ total: number; items: Row[] }>('/admin/tickets?' + params.toString()),
  });
  return (
    <>
      <PageHeader title="Support tickets" subtitle="Student-raised issues, triaged by status and assignment." />
      <FilterBar count={data?.total}>
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setSkip(0); }} className="!w-auto">
          <option value="">All statuses</option>{['OPEN', 'IN_PROGRESS', 'WAITING_FOR_STUDENT', 'RESOLVED', 'CLOSED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
        <Select aria-label="Assignment" value={assignee} onChange={(e) => { setAssignee(e.target.value as '' | 'me'); setSkip(0); }} className="!w-auto">
          <option value="">Assigned to anyone</option>
          <option value="me">Assigned to me</option>
        </Select>
      </FilterBar>
      {isLoading && <Loading />}
      {isError && <Alert>Could not load tickets.</Alert>}
      {data && (data.items.length === 0 ? <Empty title="No tickets">No tickets match these filters.</Empty> : (
        <>
          <Table sticky head={['Subject', 'Student', 'Category', 'Priority', 'Status', 'Opened', '']}>
            {data.items.map((t) => (
              <ClickableRow key={t.id} onClick={() => router.push('/admin/tickets/' + t.id)}>
                <Td className="font-medium">{t.subject}<span className="block text-xs font-normal text-fg-muted">{t.messages} repl{t.messages === 1 ? 'y' : 'ies'}</span></Td>
                <Td>{t.student}<span className="block text-xs text-fg-muted">{t.email}</span></Td>
                <Td>{label(t.category)}</Td><Td>{label(t.priority)}</Td><Td><Badge status={t.status} /></Td><Td>{date(t.createdAt)}</Td>
                <Td><span className="text-primary">Open →</span></Td>
              </ClickableRow>
            ))}
          </Table>
          <Pagination skip={skip} take={TAKE} total={data.total} onSkip={setSkip} />
        </>
      ))}
    </>
  );
}
