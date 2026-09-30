'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Empty, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { date, label, money } from '@/lib/format';

interface Row {
  id: string; reference: string; status: string; total: string; discount: string; currency: string; createdAt: string;
  student: { firstName: string; lastName: string; user: { email: string } };
  items: { batch: { name: string; course: { title: string } } }[]; payments: { status: string; provider: string }[];
}

export default function OrdersAdminPage() {
  const [status, setStatus] = useState('');
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-orders', status], queryFn: () => api<Row[]>(`/admin/orders${status ? `?status=${status}` : ''}`) });
  return (
    <>
      <PageHeader title="Orders" subtitle="Financial records are never deleted." />
      <div className="mb-4 max-w-xs"><Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All</option>{['AWAITING_PAYMENT', 'PENDING_REVIEW', 'PAID', 'CANCELLED', 'EXPIRED', 'REFUNDED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
      </Select></div>
      {isLoading && <Loading />}
      {isError && <Alert>Could not load orders.</Alert>}
      {data && (data.length === 0 ? <Empty>No orders.</Empty> : (
        <Table head={['Reference', 'Student', 'Course / batch', 'Total', 'Payment', 'Status', 'Created']}>
          {data.map((o) => (
            <tr key={o.id}>
              <Td className="font-mono text-xs">{o.reference}</Td>
              <Td>{o.student.firstName} {o.student.lastName}<span className="block text-xs text-slate-500">{o.student.user.email}</span></Td>
              <Td>{o.items[0]?.batch.course.title}<span className="block text-xs text-slate-500">{o.items[0]?.batch.name}</span></Td>
              <Td>{money(o.total, o.currency)}{Number(o.discount) > 0 && <span className="block text-xs text-green-700">−{money(o.discount, o.currency)}</span>}</Td>
              <Td>{o.payments[0] ? <Badge status={o.payments[0].status} /> : '—'}</Td>
              <Td><Badge status={o.status} /></Td><Td>{date(o.createdAt, true)}</Td>
            </tr>
          ))}
        </Table>
      ))}
    </>
  );
}
