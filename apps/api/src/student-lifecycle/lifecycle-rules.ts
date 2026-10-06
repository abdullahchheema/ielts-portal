/**
 * Student lifecycle rules. Pure: no database, no clock. The service applies these; the tests check them directly.
 *
 * A visitor has no account, so VISITOR is never stored. Referral clicks are the only pre-account signal.
 */

export const LIFECYCLE_STAGES = [
  'REGISTERED', 'APPLICATION_STARTED', 'APPLICATION_SUBMITTED', 'PAYMENT_PENDING', 'PAYMENT_APPROVED',
  'ENROLLED', 'ACTIVE', 'AT_RISK', 'INACTIVE', 'COMPLETED', 'ALUMNI',
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/** Where each stage may move to. Anything not listed is refused, and system signals for it are ignored. */
const NEXT: Record<LifecycleStage, readonly LifecycleStage[]> = {
  REGISTERED: ['APPLICATION_STARTED', 'APPLICATION_SUBMITTED'],
  APPLICATION_STARTED: ['APPLICATION_SUBMITTED', 'REGISTERED'],
  APPLICATION_SUBMITTED: ['PAYMENT_PENDING', 'PAYMENT_APPROVED', 'ENROLLED', 'REGISTERED'],
  PAYMENT_PENDING: ['PAYMENT_APPROVED', 'ENROLLED', 'REGISTERED'],
  PAYMENT_APPROVED: ['ENROLLED'],
  ENROLLED: ['ACTIVE', 'AT_RISK', 'INACTIVE', 'COMPLETED'],
  ACTIVE: ['AT_RISK', 'INACTIVE', 'COMPLETED'],
  AT_RISK: ['ACTIVE', 'INACTIVE', 'COMPLETED'],
  INACTIVE: ['ACTIVE', 'AT_RISK', 'COMPLETED'],
  COMPLETED: ['ALUMNI', 'ENROLLED', 'ACTIVE'],
  ALUMNI: ['ENROLLED', 'ACTIVE'],
};

/** A null `from` means no stage has been recorded yet: the first stage is accepted from any signal. */
export function canTransition(from: LifecycleStage | null, to: LifecycleStage): boolean {
  if (from === null) return true;
  if (from === to) return false;
  return NEXT[from].includes(to);
}

export function allowedNext(from: LifecycleStage): readonly LifecycleStage[] {
  return NEXT[from];
}

export function isLifecycleStage(value: string): value is LifecycleStage {
  return (LIFECYCLE_STAGES as readonly string[]).includes(value);
}

/** Engagement status (from the engagement module) mapped onto the lifecycle. REACTIVATED means active again. */
export function stageFromEngagement(status: 'ACTIVE' | 'AT_RISK' | 'INACTIVE' | 'REACTIVATED'): LifecycleStage {
  if (status === 'REACTIVATED') return 'ACTIVE';
  return status;
}

/** The alumni area is for students whose lifecycle stage is ALUMNI. Nothing else grants access. */
export function isAlumniStage(stage: string | null | undefined): boolean {
  return stage === 'ALUMNI';
}
