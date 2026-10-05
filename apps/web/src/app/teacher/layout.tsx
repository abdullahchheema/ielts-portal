'use client';

import { ClipboardCheck, Layers, LayoutDashboard } from 'lucide-react';
import { ReactNode } from 'react';
import { Shell } from '@/components/Shell';
import { RequireAuth, useMe } from '@/lib/auth';

function TeacherShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <Shell
      title="Teacher Portal"
      me={me}
      groups={[{ items: [
        { href: '/teacher', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/teacher/batches', label: 'My Batches', icon: Layers },
        { href: '/teacher/grading', label: 'Grading Queue', icon: ClipboardCheck },
      ] }]}
    >
      {children}
    </Shell>
  );
}

export default function TeacherLayout({ children }: { children: ReactNode }) {
  return <RequireAuth area="teacher"><TeacherShell>{children}</TeacherShell></RequireAuth>;
}
