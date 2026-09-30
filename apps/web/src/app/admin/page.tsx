'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Card, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';

interface Dash {
  students: number | null; pendingApplications: number | null; pendingVerifications: number | null; enrolledStudents: number | null;
  activeBatches: number | null; upcomingBatches: number | null; teachers: number | null;
}

export default function AdminDashboard() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-dashboard'], queryFn: () => api<Dash>('/admin/dashboard') });
  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>Could not load the dashboard.</Alert>;
  const tiles: { label: string; value: number | null; href: string; hot?: boolean }[] = [
    { label: 'Pending applications', value: data.pendingApplications, href: '/admin/applications', hot: (data.pendingApplications ?? 0) > 0 },
    { label: 'Payments to verify', value: data.pendingVerifications, href: '/admin/applications', hot: (data.pendingVerifications ?? 0) > 0 },
    { label: 'Enrolled students', value: data.enrolledStudents, href: '/admin/students' },
    { label: 'Total students', value: data.students, href: '/admin/students' },
    { label: 'Active batches', value: data.activeBatches, href: '/admin/batches' },
    { label: 'Upcoming batches', value: data.upcomingBatches, href: '/admin/batches' },
    { label: 'Teachers', value: data.teachers, href: '/admin/teachers' },
  ];
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Where the academy stands today." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.filter((t) => t.value !== null).map((t) => (
          <Link key={t.label} href={t.href}>
            <Card className={t.hot ? 'ring-2 ring-amber-400' : ''}>
              <p className="text-sm text-slate-500">{t.label}</p>
              <p className="mt-1 text-3xl font-semibold">{t.value}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
