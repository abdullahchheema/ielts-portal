'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Empty, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { date, label } from '@/lib/format';

interface Row { id: string; subject: string; category: string; priority: string; status: string; createdAt: string; student: string; email: string; messages: number }

export default function TicketsPage() {
  const [status, setStatus] = useState('OPEN');
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-tickets', status], queryFn: () => api<{ total: number; items: Row[] }>('/admin/tickets?take=50' + (status ? '&status=' + status : '')) });
  return (
    <>
      <PageHeader title="Support tickets" />
      <div className="mb-4 max-w-xs"><Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All</option>{['OPEN', 'IN_PROGRESS', 'WAITING_FOR_STUDENT', 'RESOLVED', 'CLOSED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
      </Select></div>
      {isLoading && <Loading />}
      {isError && <Alert>Could not load tickets.</Alert>}
      {data && (data.items.length === 0 ? <Empty>No tickets.</Empty> : (
        <Table head={['Subject', 'Student', 'Category', 'Priority', 'Status', 'Opened', '']}>
          {data.items.map((t) => (
            <tr key={t.id}>
              <Td className="font-medium">{t.subject}<span className="block text-xs font-normal text-fg-muted">{t.messages} repl{t.messages === 1 ? 'y' : 'ies'}</span></Td>
              <Td>{t.student}<span className="block text-xs text-fg-muted">{t.email}</span></Td>
              <Td>{label(t.category)}</Td><Td>{label(t.priority)}</Td><Td><Badge status={t.status} /></Td><Td>{date(t.createdAt)}</Td>
              <Td><Link href={'/admin/tickets/' + t.id} className="text-primary hover:underline">Open</Link></Td>
            </tr>
          ))}
        </Table>
      ))}
    </>
  );
}
