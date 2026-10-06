'use client';

import { BarChart3, BookMarked, BookOpen, CalendarDays, ClipboardList, Gift, Headphones, LayoutDashboard, LifeBuoy, Mic, PenLine, Receipt, Sparkles, Target, TrendingUp, UserCircle, Users } from 'lucide-react';
import { ReactNode } from 'react';
import { Shell } from '@/components/Shell';
import { RequireAuth, useMe } from '@/lib/auth';

function StudentShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <Shell
      title="Student Portal"
      me={me}
      groups={[
        { items: [{ href: '/student', label: 'Dashboard', icon: LayoutDashboard }] },
        { title: 'My course', items: [
          { href: '/student/course', label: 'My Course', icon: BookOpen },
          { href: '/student/batch', label: 'My Batch', icon: Users },
          { href: '/student/schedule', label: 'Class Schedule', icon: CalendarDays },
          { href: '/student/mock-tests', label: 'Mock Tests', icon: ClipboardList },
        ] },
        { title: 'Modules', items: [
          { href: '/student/listening', label: 'Listening', icon: Headphones },
          { href: '/student/reading', label: 'Reading', icon: BookMarked },
          { href: '/student/writing', label: 'Writing', icon: PenLine },
          { href: '/student/speaking', label: 'Speaking', icon: Mic },
          { href: '/student/writing-ai', label: 'Writing practice', icon: PenLine },
          { href: '/student/speaking-ai', label: 'Speaking practice', icon: Mic },
          { href: '/student/simulator', label: 'Full simulator', icon: ClipboardList },
          { href: '/student/tutor', label: 'AI tutor', icon: Sparkles },
        ] },
        { title: 'Me', items: [
          { href: '/student/progress', label: 'Progress', icon: TrendingUp },
          { href: '/student/insights', label: 'Insights', icon: Target },
          { href: '/student/study-plan', label: 'Study plan', icon: CalendarDays },
          { href: '/student/vocabulary', label: 'Vocabulary', icon: BookOpen },
          { href: '/student/grammar', label: 'Grammar tracker', icon: PenLine },
          { href: '/student/writing-ai/history', label: 'Writing history', icon: TrendingUp },
          { href: '/student/diagnostic', label: 'Diagnostic Test', icon: Target },
          { href: '/student/application', label: 'Application & Payment', icon: Receipt },
          { href: '/student/referrals', label: 'Referrals', icon: Gift },
          { href: '/student/recordings', label: 'Class recordings', icon: Headphones },
          { href: '/student/leaderboard', label: 'Leaderboard', icon: Target },
          { href: '/student/support', label: 'Support', icon: LifeBuoy },
          { href: '/student/profile', label: 'Profile', icon: UserCircle },
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
