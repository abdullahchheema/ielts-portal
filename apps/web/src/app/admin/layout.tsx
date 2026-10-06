'use client';

import { UserCheck, BarChart3, Database, FileCheck2, Gift, GraduationCap, Layers, Lock, Library, LayoutDashboard, ListChecks, MessagesSquare, Receipt, RotateCcw, ScrollText, Settings, Scale, Tag, UserRound, Wallet, ClipboardList, UsersRound } from 'lucide-react';
import { ReactNode, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Shell } from '@/components/Shell';
import { CommandItem, CommandPalette, useCommandShortcut } from '@/components/ui';
import { api } from '@/lib/api';
import { RequireAuth, can, useMe } from '@/lib/auth';

interface SearchSection { type: string; items: { id: string; label: string; sub?: string; href: string }[] }

function AdminShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const openPalette = useCallback(() => setOpen(true), []);
  useCommandShortcut(openPalette);
  const results = useQuery({
    queryKey: ['global-search', query],
    queryFn: () => api<SearchSection[]>(`/search?q=${encodeURIComponent(query.trim())}`),
    enabled: open && query.trim().length >= 2,
  });
  const items: CommandItem[] = (results.data ?? []).flatMap((s) => s.items.map((i) => ({ id: i.id, group: s.type, label: i.label, hint: i.sub, href: i.href })));
  if (!me) return null;
  const c = (p: string) => can(me, p);
  return (
    <>
    <CommandPalette open={open} onClose={() => { setOpen(false); setQuery(''); }} items={items} query={query} onQuery={setQuery} loading={results.isFetching} />
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
          { href: '/admin/question-bank', label: 'Question bank', icon: Database, show: c('question.manage') },
          { href: '/admin/bands', label: 'Band conversion', icon: Scale, show: c('assessment.manage') },
          { href: '/admin/mock-exams', label: 'Mock tests', icon: ClipboardList, show: c('assessment.manage') },
        ] },
        { title: 'Finance', items: [
          { href: '/admin/orders', label: 'Payments & orders', icon: Wallet, show: c('payment.view') },
          { href: '/admin/refunds', label: 'Refunds', icon: RotateCcw, show: c('payment.refund') },
          { href: '/admin/coupons', label: 'Coupons', icon: Tag, show: c('coupon.manage') },
          { href: '/admin/referrals', label: 'Referrals', icon: Gift, show: c('referral.manage') },
        ] },
        { title: 'Support', items: [{ href: '/admin/tickets', label: 'Tickets', icon: MessagesSquare, show: c('ticket.manage') }] },
        { title: 'Student care', items: [
          { href: '/admin/engagement', label: 'Engagement', icon: UsersRound, show: c('engagement.followup') },
          { href: '/admin/attendance-corrections', label: 'Attendance corrections', icon: ClipboardList, show: c('attendance.correct') },
        ] },
        { title: 'Reports', items: [
          { href: '/admin/analytics', label: 'Analytics', icon: BarChart3, show: c('report.academic.view') && c('student.view') },
          { href: '/admin/analytics/content', label: 'Course & questions', icon: Library, show: c('report.academic.view') && c('course.view') },
          { href: '/admin/reports', label: 'Reports', icon: BarChart3, show: c('report.finance.view') || c('report.academic.view') },
          { href: '/admin/cohorts', label: 'Cohorts', icon: Layers, show: c('report.academic.view') },
          { href: '/admin/reconciliation', label: 'Reconciliation', icon: Wallet, show: c('payment.reconcile') || c('payment.verify') },
        ] },
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
    </>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <RequireAuth area="admin"><AdminShell>{children}</AdminShell></RequireAuth>;
}
