'use client';

import { useConfirm } from '@/components/ui';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, ClickableRow, DropdownMenu, Empty, FilterBar, Loading, PageHeader, Pagination, SearchInput, Select, Table, Td } from '@/components/ui';
import { AdminResetPasswordDialog } from '@/components/AdminResetPasswordDialog';
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
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [ieltsFilter, setIeltsFilter] = useState<'' | 'NOT_TAKEN' | 'TAKEN'>('');
  const [skip, setSkip] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [resetPwUser, setResetPwUser] = useState<Row | null>(null);
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
      <PageHeader title="Students" subtitle="Everyone with a student account, across every batch." />
      <FilterBar count={data?.total}>
        <SearchInput label="Search students" placeholder="Search name or email…" value={search} onDebounced={(v) => { setSearch(v); setSkip(0); }} />
        <div className="w-44"><Select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setSkip(0); }}>
          <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="PENDING_VERIFICATION">Pending verification</option><option value="SUSPENDED">Suspended</option><option value="BLOCKED">Blocked</option>
        </Select></div>
        <div className="w-44"><Select aria-label="Filter by IELTS history" value={ieltsFilter} onChange={(e) => setIeltsFilter(e.target.value as typeof ieltsFilter)}>
          <option value="">IELTS: All</option><option value="NOT_TAKEN">Not taken</option><option value="TAKEN">Taken</option>
        </Select></div>
      </FilterBar>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {isLoading && <Loading />}
      {isError && <Alert>Could not load students.</Alert>}
      {data && (items.length === 0 ? <Empty title="No students match">Try a different search or clear the filters.</Empty> : (
        <>
          <Table head={['Student', 'IELTS', 'Exam', 'Enrollments', 'Joined', 'Status', '']} sticky>
            {items.map((u) => {
              const actionItems = [
                ...(can(me, 'admin.manage') ? [{ key: 'reset', label: 'Reset password', onSelect: () => setResetPwUser(u) }] : []),
                ...(can(me, 'student.edit')
                  ? (u.status === 'ACTIVE'
                    ? [{ key: 'suspend', label: 'Suspend', danger: true, onSelect: () => { confirm({ message: `Suspend ${u.email}? They will be signed out immediately.`, tone: 'danger', confirmLabel: 'Suspend' }).then((ok) => { if (ok) { setUserStatus(u.id, 'SUSPENDED'); } }); } }]
                    : (u.status === 'SUSPENDED' || u.status === 'BLOCKED')
                      ? [{ key: 'reactivate', label: 'Reactivate', onSelect: () => setUserStatus(u.id, 'ACTIVE') }]
                      : [])
                  : []),
              ];
              return (
                <ClickableRow key={u.id} onClick={() => router.push(`/admin/students/${u.student.id}`)}>
                  <Td>
                    <Link href={`/admin/students/${u.student.id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{u.student.firstName} {u.student.lastName}</Link>
                    <span className="block text-xs text-fg-muted">{u.email}</span>
                  </Td>
                  <Td><IeltsBadge ielts={u.student.ielts} /></Td>
                  <Td>{date(u.student.ieltsExamDate)}</Td>
                  <Td>{u.student._count.enrollments}</Td>
                  <Td>{date(u.createdAt)}</Td>
                  <Td><Badge status={u.status} /></Td>
                  <Td>
                    <span className="flex justify-end gap-1">
                      <Button variant="ghost" size="xs" aria-label="Quick view" onClick={(e) => { e.stopPropagation(); setOpenId(u.student.id); }}><Eye className="size-4" /></Button>
                      {actionItems.length > 0 && (
                        <DropdownMenu
                          trigger={<Button variant="ghost" size="xs" onClick={(e) => e.stopPropagation()}>Action</Button>}
                          items={actionItems}
                        />
                      )}
                    </span>
                  </Td>
                </ClickableRow>
              );
            })}
          </Table>
          {ieltsFilter && <p className="mt-2 text-xs text-fg-subtle">The IELTS filter only narrows the students already on this page.</p>}
          <Pagination skip={skip} take={PAGE} total={data.total} onSkip={setSkip} />
        </>
      ))}
      <StudentDetailDialog studentId={openId} onClose={() => setOpenId(null)} />
      <AdminResetPasswordDialog open={!!resetPwUser} onClose={() => setResetPwUser(null)} userId={resetPwUser?.id ?? null} userLabel={resetPwUser ? `${resetPwUser.student.firstName} ${resetPwUser.student.lastName} (${resetPwUser.email})` : ''} />
    </>
  );
}
