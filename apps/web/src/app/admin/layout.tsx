'use client';

import { UserCheck, BarChart3, FileCheck2, GraduationCap, Layers, Lock, Library, LayoutDashboard, ListChecks, MessagesSquare, Receipt, RotateCcw, ScrollText, Settings, Scale, Tag, UserRound, Wallet, ClipboardList, UsersRound } from 'lucide-react';
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
      width="wide"
      groups={[
        { items: [{ href: '/admin', label: 'Dashboard', icon: LayoutDashboard, show: c('dashboard.view') }] },
        { title: 'Enrollment', items: [
          { href: '/admin/applications', label: 'Applications', icon: FileCheck2, show: c('payment.verify') },
          { href: '/admin/students', label: 'Students', icon: GraduationCap, show: c('student.view') },
          { href: '/admin/enrollments', label: 'Enrollments', icon: ClipboardList, show: c('enrollment.view') },
          { href: '/admin/batches', label: 'Batches', icon: Layers, show: c('batch.view') },
          { href: '/admin/teachers', label: 'Teachers', icon: UserRound, show: c('mentor.assign') },
          { href: '/admin/teacher-applications', label: 'Teacher applications', icon: UserCheck, show: c('teacher.manage') },
        ] },
        { title: 'Academics', items: [
          { href: '/admin/course', label: 'Course', icon: Library, show: c('course.view') },
          { href: '/admin/assessments', label: 'Assessments', icon: ListChecks, show: c('assessment.manage') },
          { href: '/admin/bands', label: 'Band conversion', icon: Scale, show: c('assessment.manage') },
        ] },
        { title: 'Finance', items: [
          { href: '/admin/orders', label: 'Payments & orders', icon: Wallet, show: c('payment.view') },
          { href: '/admin/refunds', label: 'Refunds', icon: RotateCcw, show: c('payment.refund') },
          { href: '/admin/coupons', label: 'Coupons', icon: Tag, show: c('coupon.manage') },
        ] },
        { title: 'Support', items: [{ href: '/admin/tickets', label: 'Tickets', icon: MessagesSquare, show: c('ticket.manage') }] },
        { title: 'Reports', items: [{ href: '/admin/reports', label: 'Reports', icon: BarChart3, show: c('report.finance.view') || c('report.academic.view') }] },
        { title: 'System', items: [
          { href: '/admin/staff', label: 'Staff & roles', icon: UsersRound, show: c('admin.manage') },
          { href: '/admin/settings', label: 'Settings', icon: Settings, show: c('settings.edit') },
          { href: '/admin/audit', label: 'Audit log', icon: ScrollText, show: c('audit.view') },
          { href: '/admin/security', label: 'Security (2FA)', icon: Lock, show: me.twoFactorEnabled !== false },
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
