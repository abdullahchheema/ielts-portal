'use client';

import { ReactNode } from 'react';
import { Shell } from '@/components/Shell';
import { RequireAuth, useMe } from '@/lib/auth';
import { primaryApplication, useApplications } from '@/components/student';

function StudentShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
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
          { href: '/student', label: 'Dashboard' },
          { href: '/student/today', label: 'Today' },
        ] },
        { title: 'My Learning', items: [
          { href: '/student/course', label: 'My Course' },
          { href: '/student/study-plan', label: 'Study Plan' },
        ] },
        { title: 'My Batch', items: [
          { href: '/student/batch', label: 'My Batch', show: inBatch },
          { href: '/student/schedule', label: 'Class Schedule', show: inBatch },
          { href: '/student/recordings', label: 'Class Recordings', show: inBatch },
        ] },
        { title: 'IELTS Modules', items: [
          { href: '/student/listening', label: 'Listening' },
          { href: '/student/reading', label: 'Reading' },
          { href: '/student/writing', label: 'Writing' },
          { href: '/student/speaking', label: 'Speaking' },
          { href: '/student/practice', label: 'Practice' },
        ] },
        { title: 'Assessments', items: [
          { href: '/student/diagnostic', label: 'Diagnostic' },
          { href: '/student/mock-tests', label: 'Mock Tests' },
        ] },
        { title: 'Progress & Feedback', items: [
          { href: '/student/progress', label: 'Progress' },
          { href: '/student/insights', label: 'Insights' },
          { href: '/student/feedback', label: 'Feedback & History' },
          { href: '/student/grammar', label: 'Grammar Tracker' },
          { href: '/student/vocabulary', label: 'Vocabulary' },
        ] },
        { title: 'Account', items: [
          { href: '/student/application', label: 'Application & Payment' },
          { href: '/student/support', label: 'Support' },
          { href: '/student/profile', label: 'Profile' },
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
