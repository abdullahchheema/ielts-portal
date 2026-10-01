'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, ClickableRow, DefinitionList, DetailDialog, Empty, Loading, PageHeader, Section, Select, Table, Td } from '@/components/ui';
import { ReceiptViewer } from '@/components/ReceiptViewer';
import { api } from '@/lib/api';
import { date, label, money } from '@/lib/format';

interface Row {
  id: string; reference: string; status: string; total: string; discount: string; currency: string; createdAt: string;
  student: { firstName: string; lastName: string; user: { email: string } };
  items: { batch: { name: string; course: { title: string } } }[]; payments: { id: string; status: string; provider: string }[];
}

interface PaymentDetail {
  id: string; status: string; provider: string;
  proofs: { id: string; fileUrl: string | null; fileMime: string | null; status: string }[];
}

function OrderDetailDialog({ order, onClose }: { order: Row | null; onClose: () => void }) {
  const paymentId = order?.payments[0]?.id;
  const { data: payment } = useQuery({
    queryKey: ['admin-payment', paymentId],
    queryFn: () => api<PaymentDetail>(`/admin/payments/${paymentId}`),
    enabled: !!paymentId,
  });
  return (
    <DetailDialog open={!!order} onClose={onClose} title={order ? `Order ${order.reference}` : 'Order'} subtitle={order ? `${order.student.firstName} ${order.student.lastName} · ${order.student.user.email}` : undefined}>
      {order && (
        <Section>
          <DefinitionList items={[
            { label: 'Course / batch', value: `${order.items[0]?.batch.course.title ?? '—'} / ${order.items[0]?.batch.name ?? '—'}` },
            { label: 'Total', value: money(order.total, order.currency) },
            { label: 'Discount', value: Number(order.discount) > 0 ? money(order.discount, order.currency) : '—' },
            { label: 'Order status', value: <Badge status={order.status} /> },
            { label: 'Created', value: date(order.createdAt, true) },
          ]} />
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Payments</h3>
            {order.payments.length === 0 ? <Empty>No payment recorded for this order yet.</Empty> : (
              <ul className="space-y-2">
                {order.payments.map((p, i) => (
                  <li key={i} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
                    <span>{label(p.provider)}</span><Badge status={p.status} />
                  </li>
                ))}
              </ul>
            )}
            {payment?.proofs?.[0]?.fileUrl && (
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Receipt</h3>
                <ReceiptViewer fileUrl={payment.proofs[0].fileUrl} fileMime={payment.proofs[0].fileMime} />
              </div>
            )}
          </div>
        </Section>
      )}
    </DetailDialog>
  );
}

export default function OrdersAdminPage() {
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<Row | null>(null);
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
            <ClickableRow key={o.id} onClick={() => setOpen(o)}>
              <Td className="font-mono text-xs">{o.reference}</Td>
              <Td>{o.student.firstName} {o.student.lastName}<span className="block text-xs text-slate-500">{o.student.user.email}</span></Td>
              <Td>{o.items[0]?.batch.course.title}<span className="block text-xs text-slate-500">{o.items[0]?.batch.name}</span></Td>
              <Td>{money(o.total, o.currency)}{Number(o.discount) > 0 && <span className="block text-xs text-green-700">−{money(o.discount, o.currency)}</span>}</Td>
              <Td>{o.payments[0] ? <Badge status={o.payments[0].status} /> : '—'}</Td>
              <Td><Badge status={o.status} /></Td><Td>{date(o.createdAt, true)}</Td>
            </ClickableRow>
          ))}
        </Table>
      ))}
      <OrderDetailDialog order={open} onClose={() => setOpen(null)} />
    </>
  );
}
