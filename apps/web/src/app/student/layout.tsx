'use client';

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
        { items: [{ href: '/student', label: 'Dashboard' }] },
        { title: 'My course', items: [
          { href: '/student/course', label: 'My Course' },
          { href: '/student/batch', label: 'My Batch' },
          { href: '/student/schedule', label: 'Class Schedule' },
          { href: '/student/mock-tests', label: 'Mock Tests' },
        ] },
        { title: 'Modules', items: [
          { href: '/student/listening', label: 'Listening' },
          { href: '/student/reading', label: 'Reading' },
          { href: '/student/writing', label: 'Writing' },
          { href: '/student/speaking', label: 'Speaking' },
          { href: '/student/ai-practice', label: 'AI Practice' },
        ] },
        { title: 'Me', items: [
          { href: '/student/progress', label: 'Progress' },
          { href: '/student/diagnostic', label: 'Diagnostic Test' },
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
