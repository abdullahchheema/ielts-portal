'use client';

import { BookOpen, FileCheck2, GraduationCap, Layers, UserRound, Users, Wallet } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Empty, Loading, PageHeader, Section, SkeletonCards, StatCard } from '@/components/ui';
import { api } from '@/lib/api';

interface Dash {
  students: number | null; pendingApplications: number | null; pendingVerifications: number | null; enrolledStudents: number | null;
  activeBatches: number | null; upcomingBatches: number | null; teachers: number | null;
}

export default function AdminDashboard() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-dashboard'], queryFn: () => api<Dash>('/admin/dashboard') });
  if (isLoading) return <><PageHeader title="Dashboard" subtitle="Where the academy stands today." /><SkeletonCards count={6} /></>;
  if (isError || !data) return <Alert>Could not load the dashboard.</Alert>;

  const needsAction = [
    { label: 'Pending applications', value: data.pendingApplications, href: '/admin/applications', icon: FileCheck2, attention: (data.pendingApplications ?? 0) > 0 },
    { label: 'Payments to verify', value: data.pendingVerifications, href: '/admin/applications', icon: Wallet, attention: (data.pendingVerifications ?? 0) > 0 },
  ].filter((t) => t.value !== null);
  const overview = [
    { label: 'Enrolled students', value: data.enrolledStudents, href: '/admin/students', icon: GraduationCap },
    { label: 'Total students', value: data.students, href: '/admin/students', icon: Users },
    { label: 'Active batches', value: data.activeBatches, href: '/admin/batches', icon: Layers },
    { label: 'Upcoming batches', value: data.upcomingBatches, href: '/admin/batches', icon: BookOpen },
    { label: 'Teachers', value: data.teachers, href: '/admin/teachers', icon: UserRound },
  ].filter((t) => t.value !== null);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Where the academy stands today. Items that need action are listed first." />
      {needsAction.length === 0 && overview.length === 0 ? <Empty title="No figures yet">The dashboard has nothing to show for your role.</Empty> : null}
      {needsAction.length > 0 && (
        <Section title="Needs action" description="Work waiting on the academy team.">
          <div className="grid gap-4 sm:grid-cols-2">
            {needsAction.map((t) => <StatCard key={t.label} label={t.label} value={t.value} href={t.href} icon={t.icon} attention={t.attention} />)}
          </div>
        </Section>
      )}
      {overview.length > 0 && (
        <Section title="Overview">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {overview.map((t) => <StatCard key={t.label} label={t.label} value={t.value} href={t.href} icon={t.icon} />)}
          </div>
        </Section>
      )}
    </>
  );
}
