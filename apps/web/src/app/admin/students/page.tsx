'use client';

import { useConfirm } from '@/components/ui';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, ClickableRow, Empty, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { IeltsBadge, IeltsSummaryLike } from '@/components/IeltsSummary';
import { StudentDetailDialog } from '@/components/StudentDetailDialog';
import { api } from '@/lib/api';
import { can, useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface Row {
  id: string; email: string; status: string; createdAt: string; lastLoginAt: string | null;
  student: { id: string; firstName: string; lastName: string; currentBand: string | null; targetBand: string | null; ieltsExamDate: string | null; _count: { enrollments: number }; ielts?: IeltsSummaryLike };
}
interface Page { total: number; items: Row[] }
const PAGE = 25;

export default function StudentsPage() {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [ieltsFilter, setIeltsFilter] = useState<'' | 'NOT_TAKEN' | 'TAKEN'>('');
  const [skip, setSkip] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const qs = new URLSearchParams({ skip: String(skip), take: String(PAGE), ...(search ? { search } : {}), ...(status ? { status } : {}) }).toString();
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-students', qs], queryFn: () => api<Page>(`/admin/students?${qs}`) });
  const items = (data?.items ?? []).filter((u) => !ieltsFilter || (u.student?.ielts?.status ?? 'NOT_TAKEN') === ieltsFilter);

  async function setUserStatus(userId: string, next: 'ACTIVE' | 'SUSPENDED') {
    setError(null);
    try { await api(`/admin/students/${userId}/status`, { method: 'PATCH', body: { status: next } }); qc.invalidateQueries({ queryKey: ['admin-students'] }); }
    catch (e) { setError(errorMessage(e)); }
  }

  return (
    <>
      <PageHeader title="Students" />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-full max-w-xs"><Input aria-label="Search students" placeholder="Search name or email…" value={search} onChange={(e) => { setSearch(e.target.value); setSkip(0); }} /></div>
        <div className="w-44"><Select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setSkip(0); }}>
          <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="PENDING_VERIFICATION">Pending verification</option><option value="SUSPENDED">Suspended</option><option value="BLOCKED">Blocked</option>
        </Select></div>
        <div className="w-44"><Select aria-label="Filter by IELTS history" value={ieltsFilter} onChange={(e) => setIeltsFilter(e.target.value as typeof ieltsFilter)}>
          <option value="">IELTS: All</option><option value="NOT_TAKEN">Not taken</option><option value="TAKEN">Taken</option>
        </Select></div>
      </div>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {isLoading && <Loading />}
      {isError && <Alert>Could not load students.</Alert>}
      {data && (items.length === 0 ? <Empty>No students match.</Empty> : (
        <>
          <Table head={['Student', 'IELTS', 'Exam', 'Enrollments', 'Joined', 'Status', '']}>
            {items.map((u) => (
              <ClickableRow key={u.id} onClick={() => setOpenId(u.student.id)}>
                <Td>
                  <Link href={`/admin/students/${u.student.id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{u.student.firstName} {u.student.lastName}</Link>
                  <span className="block text-xs text-fg-muted">{u.email}</span>
                </Td>
                <Td><IeltsBadge ielts={u.student.ielts} /></Td>
                <Td>{date(u.student.ieltsExamDate)}</Td>
                <Td>{u.student._count.enrollments}</Td>
                <Td>{date(u.createdAt)}</Td>
                <Td><Badge status={u.status} /></Td>
                <Td>{can(me, 'student.edit') && (u.status === 'ACTIVE'
                  ? <Button variant="ghost" tone="danger" className="!py-1" onClick={(e) => { e.stopPropagation(); confirm({ message: `Suspend ${u.email}? They will be signed out immediately.`, tone: 'danger', confirmLabel: 'Suspend' }).then((ok) => { if (ok) { setUserStatus(u.id, 'SUSPENDED'); } }); }}>Suspend</Button>
                  : u.status === 'SUSPENDED' || u.status === 'BLOCKED' ? <Button variant="ghost" className="!py-1" onClick={(e) => { e.stopPropagation(); setUserStatus(u.id, 'ACTIVE'); }}>Reactivate</Button> : null)}</Td>
              </ClickableRow>
            ))}
          </Table>
          <div className="mt-3 flex items-center justify-between text-sm text-fg-muted">
            <span>{skip + 1}–{Math.min(skip + PAGE, data.total)} of {data.total}{ieltsFilter ? ' (IELTS filter applies to this page only)' : ''}</span>
            <div className="flex gap-2"><Button variant="secondary" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE))}>Previous</Button><Button variant="secondary" disabled={skip + PAGE >= data.total} onClick={() => setSkip(skip + PAGE)}>Next</Button></div>
          </div>
        </>
      ))}
      <StudentDetailDialog studentId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
