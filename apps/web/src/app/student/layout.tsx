'use client';

import { BarChart3, BookMarked, BookOpen, CalendarDays, CheckCircle2, ClipboardList, Crown, Gift, GraduationCap, Headphones, LayoutDashboard, LifeBuoy, Mic, PenLine, Receipt, Sparkles, Target, TrendingUp, UserCircle, Users } from 'lucide-react';
import { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Shell } from '@/components/Shell';
import { api } from '@/lib/api';
import { RequireAuth, useMe } from '@/lib/auth';
import { primaryApplication, useApplications } from '@/components/student';

function StudentShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const lifecycle = useQuery({ queryKey: ['my-lifecycle'], queryFn: () => api<{ alumniAccess: boolean }>('/me/lifecycle'), enabled: !!me, retry: false });
  const apps = useApplications();
  if (!me) return null;
  const app = primaryApplication(apps.data);
  const inBatch = !!app && ['ACTIVE', 'COMPLETED'].includes(app.status);

  return (
    <Shell
      title="Student Portal"
      me={me}
      groups={[
        { title: 'Home', items: [
          { href: '/student', label: 'Dashboard', icon: LayoutDashboard },
          { href: '/student/today', label: 'Today', icon: CheckCircle2 },
        ] },
        { title: 'My course', items: [
          { href: '/student/course', label: 'My Course', icon: BookOpen },
          { href: '/student/study-plan', label: 'Study plan', icon: CalendarDays },
          { href: '/student/batch', label: 'My Batch', icon: Users, show: inBatch },
          { href: '/student/schedule', label: 'Class Schedule', icon: CalendarDays, show: inBatch },
          { href: '/student/recordings', label: 'Class recordings', icon: Headphones, show: inBatch },
          { href: '/student/mock-tests', label: 'Mock Tests', icon: ClipboardList },
          { href: '/student/premium', label: 'Premium services', icon: Crown },
        ] },
        { title: 'Modules', items: [
          { href: '/student/listening', label: 'Listening', icon: Headphones },
          { href: '/student/reading', label: 'Reading', icon: BookMarked },
          { href: '/student/writing', label: 'Writing', icon: PenLine },
          { href: '/student/speaking', label: 'Speaking', icon: Mic },
          { href: '/student/practice', label: 'Practice', icon: ClipboardList },
          { href: '/student/writing-ai', label: 'Writing practice', icon: PenLine },
          { href: '/student/speaking-ai', label: 'Speaking practice', icon: Mic },
          { href: '/student/simulator', label: 'Full simulator', icon: ClipboardList },
          { href: '/student/tutor', label: 'AI tutor', icon: Sparkles },
        ] },
        { title: 'Me', items: [
          { href: '/student/progress', label: 'Progress', icon: TrendingUp },
          { href: '/student/insights', label: 'Insights', icon: Target },
          { href: '/student/feedback', label: 'Feedback & History', icon: BarChart3 },
          { href: '/student/vocabulary', label: 'Vocabulary', icon: BookOpen },
          { href: '/student/grammar', label: 'Grammar tracker', icon: PenLine },
          { href: '/student/writing-ai/history', label: 'Writing history', icon: TrendingUp },
          { href: '/student/diagnostic', label: 'Diagnostic Test', icon: Target },
          { href: '/student/application', label: 'Application & Payment', icon: Receipt },
          { href: '/student/referrals', label: 'Referrals', icon: Gift },
          { href: '/student/leaderboard', label: 'Leaderboard', icon: Target },
          { href: '/student/support', label: 'Support', icon: LifeBuoy },
          { href: '/student/profile', label: 'Profile', icon: UserCircle },
          ...(lifecycle.data?.alumniAccess ? [{ href: '/alumni', label: 'Alumni portal', icon: GraduationCap }] : []),
        ] },
      ]}
    >
      {children}
    </Shell>
  );
}

export default function StudentLayout({ children }: { children: ReactNode }) {
  return <RequireAuth area="student"><StudentShell>{children}</StudentShell></RequireAuth>;
}
