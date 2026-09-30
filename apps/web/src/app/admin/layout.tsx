'use client';

import { ReactNode } from 'react';
import { Shell } from '@/components/Shell';
import { RequireAuth, can, useMe } from '@/lib/auth';

function AdminShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  if (!me) return null;
  const c = (p: string) => can(me, p);
  return (
    <Shell
      title="Admin Portal"
      me={me}
      groups={[
        { items: [{ href: '/admin', label: 'Dashboard', show: c('dashboard.view') }] },
        { title: 'Enrollment', items: [
          { href: '/admin/applications', label: 'Applications', show: c('payment.verify') },
          { href: '/admin/students', label: 'Students', show: c('student.view') },
          { href: '/admin/enrollments', label: 'Enrollments', show: c('enrollment.view') },
          { href: '/admin/batches', label: 'Batches', show: c('batch.view') },
          { href: '/admin/teachers', label: 'Teachers', show: c('mentor.assign') },
        ] },
        { title: 'Academics', items: [
          { href: '/admin/course', label: 'Course', show: c('course.view') },
          { href: '/admin/assessments', label: 'Assessments', show: c('assessment.manage') },
          { href: '/admin/bands', label: 'Band conversion', show: c('assessment.manage') },
        ] },
        { title: 'Finance', items: [
          { href: '/admin/orders', label: 'Payments & orders', show: c('payment.view') },
          { href: '/admin/refunds', label: 'Refunds', show: c('payment.refund') },
          { href: '/admin/coupons', label: 'Coupons', show: c('coupon.manage') },
        ] },
        { title: 'Support', items: [{ href: '/admin/tickets', label: 'Tickets', show: c('ticket.manage') }] },
        { title: 'Reports', items: [{ href: '/admin/reports', label: 'Reports', show: c('report.finance.view') || c('report.academic.view') }] },
        { title: 'System', items: [
          { href: '/admin/staff', label: 'Staff & roles', show: c('admin.manage') },
          { href: '/admin/settings', label: 'Settings', show: c('settings.edit') },
          { href: '/admin/audit', label: 'Audit log', show: c('audit.view') },
          { href: '/admin/security', label: 'Security (2FA)', show: me.twoFactorEnabled !== false },
        ] },
      ]}
    >
      {children}
    </Shell>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <RequireAuth area="admin"><AdminShell>{children}</AdminShell></RequireAuth>;
}
