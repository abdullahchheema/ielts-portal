/**
 * Support routing and service levels as pure rules. The category decides the team; the priority decides the SLA.
 * Nothing here reads the database or the clock.
 */

export const ROUTE_BY_CATEGORY: Record<string, string> = {
  PAYMENT: 'FINANCE_ADMIN',
  CERTIFICATE: 'ACADEMIC_ADMIN',
  COURSE: 'ACADEMIC_ADMIN',
  ASSESSMENT: 'ACADEMIC_ADMIN',
  ENROLLMENT: 'ACADEMIC_ADMIN',
  CLASS: 'ACADEMIC_ADMIN',
  MENTOR: 'ACADEMIC_ADMIN',
  TECHNICAL: 'SUPPORT_AGENT',
  ACCOUNT: 'SUPPORT_AGENT',
  OTHER: 'SUPPORT_AGENT',
};

/** The role that should handle a category. Unknown categories fall back to support. */
export const roleFor = (category: string): string => ROUTE_BY_CATEGORY[category] ?? 'SUPPORT_AGENT';

/** Hours to first response, by priority. Urgent tickets are due soonest. */
export const SLA_HOURS: Record<string, number> = { URGENT: 4, HIGH: 12, NORMAL: 24, LOW: 48 };

export const slaDueAt = (createdAt: Date, priority: string): Date =>
  new Date(createdAt.getTime() + (SLA_HOURS[priority] ?? SLA_HOURS.NORMAL) * 3_600_000);

export type SlaState = 'ON_TRACK' | 'DUE_SOON' | 'BREACHED' | 'MET';

/** Where a ticket stands against its SLA. A first response (or resolution) ends the clock. */
export function slaState(t: { slaDueAt: Date | null; firstResponseAt: Date | null; status: string }, now: Date): SlaState {
  if (t.firstResponseAt) return 'MET';
  if (t.status === 'RESOLVED' || t.status === 'CLOSED') return 'MET';
  if (!t.slaDueAt) return 'ON_TRACK';
  const left = t.slaDueAt.getTime() - now.getTime();
  if (left <= 0) return 'BREACHED';
  if (left <= 2 * 3_600_000) return 'DUE_SOON';
  return 'ON_TRACK';
}

/** Picks the staff member with the fewest open tickets. Ties go to the earliest id so the choice is stable. */
export function leastLoaded(candidates: { id: string; open: number }[]): string | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => a.open - b.open || (a.id < b.id ? -1 : 1))[0].id;
}
