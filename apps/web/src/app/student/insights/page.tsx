'use client';

import { useQuery } from '@tanstack/react-query';
import { InsightsPanels, Readiness, TargetPlan, Weakness } from '@/components/InsightsPanels';
import { PageHeader } from '@/components/ui';
import { api } from '@/lib/api';

/** Where you are weak, how ready you are, and what a target would take. Every number here is an estimate. */
export default function InsightsPage() {
  const weak = useQuery({ queryKey: ['weakness'], queryFn: () => api<Weakness>('/me/weakness') });
  const ready = useQuery({ queryKey: ['readiness'], queryFn: () => api<Readiness>('/me/readiness') });
  const target = useQuery({ queryKey: ['target-band'], queryFn: () => api<TargetPlan>('/me/target-band') });

  return (
    <>
      <PageHeader title="Insights" subtitle="Your weak areas, readiness and what a target would take. These are estimates to help you plan." />
      <InsightsPanels weak={weak} ready={ready} target={target} />
    </>
  );
}
