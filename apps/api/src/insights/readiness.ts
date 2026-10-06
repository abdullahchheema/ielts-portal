/**
 * Readiness estimate. Pure: the caller passes every signal and the weights.
 * It is an estimate of how prepared a student is, never a probability of reaching a band.
 */

export interface ReadinessWeights {
  scores: number;
  mocks: number;
  consistency: number;
  completion: number;
  attendance: number;
  assignments: number;
  balance: number;
  trend: number;
}

export const DEFAULT_READINESS_WEIGHTS: ReadinessWeights = {
  scores: 0.25, mocks: 0.15, consistency: 0.1, completion: 0.1, attendance: 0.1, assignments: 0.1, balance: 0.1, trend: 0.1,
};

export interface ReadinessSignals {
  /** Recent section bands, newest first, for the skills that have been assessed. */
  recentScores: { skill: string; band: number }[];
  target: number | null;
  mockCountLast60Days: number;
  /** Standard deviation of recent section bands, in bands. */
  bandSpread: number | null;
  /** Share of course content completed, 0–1. Null when there is no course. */
  completion: number | null;
  /** Attendance share, 0–1. Null when no sessions have been held. */
  attendance: number | null;
  /** Assignments submitted on time or late, share of those due, 0–1. Null when none are due. */
  assignments: number | null;
  /** Current estimates per skill. Null where a skill has no estimate. */
  skillEstimates: Record<string, number | null>;
  trend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';
}

export interface ReadinessResult {
  percent: number;
  label: 'Readiness estimate';
  components: { key: keyof ReadinessWeights; score: number; weight: number }[];
  reasons: string[];
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function readiness(s: ReadinessSignals, weights: ReadinessWeights = DEFAULT_READINESS_WEIGHTS): ReadinessResult {
  const reasons: string[] = [];
  const target = s.target;

  // Scores: share of recent section results at or above target minus half a band.
  const hits = s.recentScores.filter((r) => (target === null ? true : r.band >= target - 0.5)).length;
  const scoreComponent = s.recentScores.length === 0 ? 0.5 : hits / s.recentScores.length;
  if (target !== null && s.recentScores.length > 0 && scoreComponent < 0.6) {
    const below = [...new Set(s.recentScores.filter((r) => r.band < target - 0.5).map((r) => label(r.skill)))];
    if (below.length) reasons.push(`Your readiness is lower because ${below.join(' and ')} ${below.length > 1 ? 'have' : 'has'} remained below your target for recent attempts.`);
  }

  const mocks = clamp01(s.mockCountLast60Days / 3);
  if (s.mockCountLast60Days === 0) reasons.push('No mock test in the last 60 days. A full mock is the best check of exam readiness.');

  const consistency = s.bandSpread === null ? 0.5 : clamp01(1 - s.bandSpread / 1.5);
  if (s.bandSpread !== null && s.bandSpread >= 1) reasons.push('Your recent results swing a lot. Steadier practice will help.');

  const completion = s.completion ?? 0.5;
  if (s.completion !== null && s.completion < 0.6) reasons.push(`Course content is ${Math.round(s.completion * 100)}% complete.`);

  const attendance = s.attendance ?? 0.5;
  if (s.attendance !== null && s.attendance < 0.8) reasons.push(`Attendance is ${Math.round(s.attendance * 100)}%.`);

  const assignments = s.assignments ?? 0.5;
  if (s.assignments !== null && s.assignments < 0.75) reasons.push('Some assignments are not yet submitted.');

  const known = Object.entries(s.skillEstimates).filter(([, v]) => v !== null).map(([, v]) => v as number);
  const balance = known.length < 2 ? 0.5 : clamp01(1 - (Math.max(...known) - Math.min(...known)) / 2);
  if (known.length >= 2 && balance < 0.6) {
    const weakest = Object.entries(s.skillEstimates).filter(([, v]) => v !== null).sort((a, b) => (a[1] as number) - (b[1] as number))[0][0];
    reasons.push(`${label(weakest)} is well behind your other skills.`);
  }

  const trendValue = s.trend === 'IMPROVING' ? 1 : s.trend === 'STABLE' ? 0.6 : s.trend === 'DECLINING' ? 0.2 : 0.5;
  if (s.trend === 'DECLINING') reasons.push('Your estimated band has been falling recently.');

  const comps: Record<keyof ReadinessWeights, number> = {
    scores: scoreComponent, mocks, consistency, completion, attendance, assignments, balance, trend: trendValue,
  };
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const raw = (Object.keys(weights) as (keyof ReadinessWeights)[]).reduce((sum, k) => sum + comps[k] * weights[k], 0) / totalWeight;
  return {
    percent: Math.round(raw * 100),
    label: 'Readiness estimate',
    components: (Object.keys(weights) as (keyof ReadinessWeights)[]).map((k) => ({ key: k, score: Math.round(comps[k] * 100) / 100, weight: weights[k] })),
    reasons: reasons.slice(0, 5),
  };
}

const label = (skill: string) => skill[0] + skill.slice(1).toLowerCase();

/** Standard deviation of a list of bands. Null with fewer than two values. */
export function spreadOf(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}
