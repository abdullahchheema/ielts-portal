'use client';

import { GraduationCap, Gift, Headphones, Home, UserCircle } from 'lucide-react';
import { ReactNode } from 'react';
import { Shell } from '@/components/Shell';
import { RequireAuth, useMe } from '@/lib/auth';

function AlumniShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <Shell
      title="Alumni Portal"
      me={me}
      groups={[
        { items: [
          { href: '/alumni', label: 'Home', icon: Home },
          { href: '/alumni/recordings', label: 'Revision library', icon: Headphones },
        ] },
        { title: 'Account', items: [
          { href: '/student/referrals', label: 'Referrals', icon: Gift },
          { href: '/student/profile', label: 'Profile', icon: UserCircle },
          { href: '/student', label: 'Student portal', icon: GraduationCap },
        ] },
      ]}
    >
      {children}
    </Shell>
  );
}

/** Alumni area. The API decides access (stage ALUMNI and the alumni.access setting); this layout only renders. */
export default function AlumniLayout({ children }: { children: ReactNode }) {
  return <RequireAuth area="alumni"><AlumniShell>{children}</AlumniShell></RequireAuth>;
}
