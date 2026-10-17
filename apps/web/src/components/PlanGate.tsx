'use client';

import Link from 'next/link';
import { ReactNode } from 'react';
import { Card } from '@/components/ui';
import { planHas, usePlan } from '@/lib/plan';

/** Wraps a feature that needs a plan entitlement. Shows an upgrade prompt instead of the feature
 *  when the student's plan doesn't include it. The backend enforces the same restriction — this
 *  is UX, not the security boundary. */
export function PlanGate({ feature, children, message }: { feature: string; children: ReactNode; message?: string }) {
  const { data: plan, isLoading } = usePlan();
  if (isLoading) return null;
  if (planHas(plan, feature)) return <>{children}</>;
  return (
    <Card className="border-dashed text-center">
      <p className="mb-2 font-semibold">This feature needs a higher plan</p>
      <p className="mb-4 text-sm text-fg-muted">{message ?? 'Upgrade your plan to unlock this.'}</p>
      <Link href="/pricing" className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary-hover">
        See plans
      </Link>
    </Card>
  );
}
