'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Empty, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { can, useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { band, date } from '@/lib/format';

interface Row {
  id: string; email: string; status: string; createdAt: string; lastLoginAt: string | null;
  student: { id: string; firstName: string; lastName: string; currentBand: string | null; targetBand: string | null; ieltsExamDate: string | null; _count: { enrollments: number } };
}
interface Page { total: number; items: Row[] }
const PAGE = 25;

export default function StudentsPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [skip, setSkip] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const qs = new URLSearchParams({ skip: String(skip), take: String(PAGE), ...(search ? { search } : {}), ...(status ? { status } : {}) }).toString();
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-students', qs], queryFn: () => api<Page>(`/admin/students?${qs}`) });

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
      </div>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {isLoading && <Loading />}
      {isError && <Alert>Could not load students.</Alert>}
      {data && (data.items.length === 0 ? <Empty>No students match.</Empty> : (
        <>
          <Table head={['Student', 'Level → target', 'Exam', 'Enrollments', 'Joined', 'Status', '']}>
            {data.items.map((u) => (
              <tr key={u.id}>
                <Td><Link href={`/admin/students/${u.student.id}`} className="font-medium text-indigo-700 hover:underline">{u.student.firstName} {u.student.lastName}</Link><span className="block text-xs text-slate-500">{u.email}</span></Td>
                <Td>{band(u.student.currentBand)} → {band(u.student.targetBand)}</Td>
                <Td>{date(u.student.ieltsExamDate)}</Td>
                <Td>{u.student._count.enrollments}</Td>
                <Td>{date(u.createdAt)}</Td>
                <Td><Badge status={u.status} /></Td>
                <Td>{can(me, 'student.edit') && (u.status === 'ACTIVE'
                  ? <Button variant="ghost" className="!py-1 text-red-600" onClick={() => confirm(`Suspend ${u.email}? They will be signed out immediately.`) && setUserStatus(u.id, 'SUSPENDED')}>Suspend</Button>
                  : u.status === 'SUSPENDED' || u.status === 'BLOCKED' ? <Button variant="ghost" className="!py-1" onClick={() => setUserStatus(u.id, 'ACTIVE')}>Reactivate</Button> : null)}</Td>
              </tr>
            ))}
          </Table>
          <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
            <span>{skip + 1}–{Math.min(skip + PAGE, data.total)} of {data.total}</span>
            <div className="flex gap-2"><Button variant="secondary" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE))}>Previous</Button><Button variant="secondary" disabled={skip + PAGE >= data.total} onClick={() => setSkip(skip + PAGE)}>Next</Button></div>
          </div>
        </>
      ))}
    </>
  );
}
