'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useMe } from './auth';

export interface MyPlan {
  planName: string; displayName: string; status: string; expiresAt: string | null;
  features: Record<string, boolean>;
}

/** The signed-in student's current plan and feature entitlements. Only fetched for student accounts. */
export function usePlan() {
  const { data: me } = useMe();
  return useQuery<MyPlan>({
    queryKey: ['my-plan'],
    queryFn: () => api<MyPlan>('/me/plan'),
    enabled: !!me?.studentId,
    staleTime: 60_000,
  });
}

export function planHas(plan: MyPlan | undefined, feature: string): boolean {
  return plan?.features[feature] === true;
}
