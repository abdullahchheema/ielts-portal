'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, DefinitionList, DetailDialog, Empty, Loading, Section, Table, Td } from '@/components/ui';
import { IeltsSummary, IeltsSummaryLike } from '@/components/IeltsSummary';
import { ReceiptViewer } from '@/components/ReceiptViewer';
import { api } from '@/lib/api';
import { band, date, money } from '@/lib/format';

interface Detail {
  id: string; firstName: string; lastName: string; currentBand: string | null; targetBand: string | null; ieltsExamDate: string | null; country: string | null; city: string | null;
  academicOrGeneral: string | null; fatherName: string | null; dateOfBirth: string | null; gender: string | null; notes: string | null; timezone: string | null;
  ielts?: IeltsSummaryLike;
  user: { email: string; phone: string | null; status: string; createdAt: string; lastLoginAt: string | null };
  enrollments: { id: string; status: string; progressPercent: string; course: { title: string }; batch: { name: string } }[];
  orders: { id: string; reference: string; status: string; total: string; currency: string; createdAt: string; payments: { id: string; status: string; provider: string }[] }[];
  timeline: { id: string; type: string; summary: string; createdAt: string }[];
}

interface PaymentDetail {
  id: string; status: string; provider: string;
  proofs: { id: string; fileUrl: string | null; fileMime: string | null; status: string }[];
}

const TABS = [
  { key: 'personal', label: 'Personal' },
  { key: 'contact', label: 'Contact' },
  { key: 'academic', label: 'Academic' },
  { key: 'enrollment', label: 'Enrollment' },
  { key: 'payment', label: 'Payment' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'notes', label: 'Notes' },
];

export function StudentDetailDialog({ studentId, onClose }: { studentId: string | null; onClose: () => void }) {
  const [tab, setTab] = useState('personal');
  const { data: s, isLoading, isError } = useQuery({
    queryKey: ['admin-student', studentId],
    queryFn: () => api<Detail>(`/admin/students/${studentId}`),
    enabled: !!studentId,
  });
  const paymentId = s?.orders.find((o) => o.payments.length > 0)?.payments[0]?.id;
  const { data: payment } = useQuery({
    queryKey: ['admin-payment', paymentId],
    queryFn: () => api<PaymentDetail>(`/admin/payments/${paymentId}`),
    enabled: !!paymentId && tab === 'payment',
  });

  return (
    <DetailDialog
      open={!!studentId}
      onClose={onClose}
      title={s ? `${s.firstName} ${s.lastName}` : 'Student'}
      subtitle={s?.user.email}
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
    >
      {isLoading && <Loading />}
      {isError && <Alert>Could not load this student.</Alert>}
      {s && (
        <>
          {tab === 'personal' && (
            <Section>
              <DefinitionList items={[
                { label: 'Full name', value: `${s.firstName} ${s.lastName}` },
                { label: "Father's name", value: s.fatherName },
                { label: 'Date of birth', value: s.dateOfBirth ? date(s.dateOfBirth) : null },
                { label: 'Gender', value: s.gender },
                { label: 'Account status', value: <Badge status={s.user.status} /> },
                { label: 'Joined', value: date(s.user.createdAt) },
                { label: 'Last login', value: date(s.user.lastLoginAt, true) },
              ]} />
            </Section>
          )}
          {tab === 'contact' && (
            <Section>
              <DefinitionList items={[
                { label: 'Email', value: s.user.email },
                { label: 'Phone', value: s.user.phone },
                { label: 'City', value: s.city },
                { label: 'Country', value: s.country },
              ]} />
            </Section>
          )}
          {tab === 'academic' && (
            <Section>
              <div className="mb-4"><IeltsSummary ielts={s.ielts} /></div>
              <DefinitionList items={[
                { label: 'Current band (self-reported)', value: band(s.currentBand) },
                { label: 'Target band', value: band(s.targetBand) },
                { label: 'Test type', value: s.academicOrGeneral },
                { label: 'Planned exam date', value: date(s.ieltsExamDate) },
              ]} />
            </Section>
          )}
          {tab === 'enrollment' && (
            <Section title="Enrollments">
              {s.enrollments.length === 0 ? <Empty>No enrollments yet.</Empty> : (
                <Table head={['Course', 'Batch', 'Progress', 'Status']}>
                  {s.enrollments.map((e) => <tr key={e.id}><Td>{e.course.title}</Td><Td>{e.batch.name}</Td><Td>{Math.round(Number(e.progressPercent))}%</Td><Td><Badge status={e.status} /></Td></tr>)}
                </Table>
              )}
            </Section>
          )}
          {tab === 'payment' && (
            <Section title="Orders">
              {s.orders.length === 0 ? <Empty>No orders yet.</Empty> : (
                <Table head={['Reference', 'Total', 'Status', 'Date']}>
                  {s.orders.map((o) => <tr key={o.id}><Td className="font-mono text-xs">{o.reference}</Td><Td>{money(o.total, o.currency)}</Td><Td><Badge status={o.status} /></Td><Td>{date(o.createdAt)}</Td></tr>)}
                </Table>
              )}
              {payment?.proofs?.[0]?.fileUrl && (
                <div className="mt-4">
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">Receipt</h3>
                  <ReceiptViewer fileUrl={payment.proofs[0].fileUrl} fileMime={payment.proofs[0].fileMime} />
                </div>
              )}
            </Section>
          )}
          {tab === 'timeline' && (
            <Section title="Timeline">
              <ol className="space-y-3 border-l-2 border-slate-100 pl-4 text-sm">
                {s.timeline.length === 0 && <li className="text-slate-500">No activity yet.</li>}
                {s.timeline.map((t) => <li key={t.id}><p className="text-xs text-slate-500">{date(t.createdAt, true)}</p><p>{t.summary}</p></li>)}
              </ol>
            </Section>
          )}
          {tab === 'notes' && (
            <Section title="Notes">
              {s.notes ? <p className="whitespace-pre-wrap text-sm text-slate-800">{s.notes}</p> : <Empty>No notes recorded.</Empty>}
            </Section>
          )}
        </>
      )}
    </DetailDialog>
  );
}
