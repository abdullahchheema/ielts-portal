'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { Loading } from '@/components/ui';
import { ApiError, api } from './api';

export interface Me {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
  studentId?: string;
  mentorId?: string;
  mfaEnabled: boolean;
  mfaSetupRequired: boolean;
  twoFactorEnabled?: boolean;
  isOwner?: boolean;
}

const STAFF = ['SUPER_ADMIN', 'ACADEMIC_ADMIN', 'CONTENT_MANAGER', 'FINANCE_ADMIN', 'SUPPORT_AGENT', 'MARKETING'];
export const isStaff = (me: Me) => me.roles.some((r) => STAFF.includes(r));
export const can = (me: Me | null | undefined, perm: string) => !!me?.permissions.includes(perm);

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try { return await api<Me>('/auth/me'); } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

/** Where a signed-in user should land. */
export function homeFor(me: Me): string {
  if (isStaff(me)) return me.mfaSetupRequired ? '/admin/security' : '/admin';
  if (me.roles.includes('MENTOR')) return '/teacher';
  return '/student';
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return async () => {
    try { await api('/auth/logout', { method: 'POST', noRefresh: true }); } catch { /* cookies are cleared server-side either way */ }
    qc.clear();
    router.push('/login');
  };
}

/** Client-side route guard. The API is the real gate; this only decides what to render and where to send people. */
export function RequireAuth({ children, area }: { children: ReactNode; area: 'student' | 'teacher' | 'admin' }) {
  const { data: me, isLoading } = useMe();
  const router = useRouter();
  const path = usePathname();

  const allowed = !!me && (area === 'admin' ? isStaff(me) : area === 'teacher' ? me.roles.includes('MENTOR') || isStaff(me) : !!me.studentId);

  useEffect(() => {
    if (isLoading) return;
    if (!me) router.replace(`/login?next=${encodeURIComponent(path)}`);
    else if (!allowed) router.replace(homeFor(me));
    else if (area === 'admin' && me.mfaSetupRequired && path !== '/admin/security') router.replace('/admin/security');
  }, [isLoading, me, allowed, area, path, router]);

  if (isLoading || !me || !allowed) return <Loading />;
  return <>{children}</>;
}
