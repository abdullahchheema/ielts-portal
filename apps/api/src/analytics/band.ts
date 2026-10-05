/**
 * Pure band-estimate rules. No database, no clock: everything here is unit-tested directly.
 *
 * Rules (see the analytics plan):
 *  - A skill's estimate is the recency-weighted mean of its most recent points (weights 3, 2, 1),
 *    rounded to the nearest half band.
 *  - An overall estimate exists only when all four skills have data. Averaging three skills and
 *    calling it an IELTS overall would mislead a student about exam readiness.
 *  - A trend needs at least two points, and a change under half a band counts as STABLE.
 */

export type Skill = 'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING';
export const SKILLS: readonly Skill[] = ['LISTENING', 'READING', 'WRITING', 'SPEAKING'];
export type Trend = 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';

/** Number of most-recent points that feed the estimate. */
export const DEFAULT_WINDOW = 3;
const WEIGHTS = [3, 2, 1];
const TREND_THRESHOLD = 0.5;

/** One scored point. `rank` 0 is the newest. */
export interface ScoredPoint { band: number }

/** Nearest half band. .25 and .75 round UP, matching the IELTS convention. */
export const roundHalfBand = (avg: number): number => Math.floor(avg * 2 + 0.5 + 1e-9) / 2;

/** Weighted mean of up to WEIGHTS.length points, newest first. Null when there are no points. */
export function weightedMean(newestFirst: number[]): number | null {
  if (newestFirst.length === 0) return null;
  const w = WEIGHTS.slice(0, newestFirst.length);
  const num = newestFirst.reduce((s, b, i) => s + b * w[i], 0);
  const den = w.reduce((s, x) => s + x, 0);
  return num / den;
}

/** Estimate over the most recent `window` points. Null when there is no data. */
export function estimateFrom(newestFirst: number[], window = DEFAULT_WINDOW): number | null {
  const mean = weightedMean(newestFirst.slice(0, window));
  return mean === null ? null : roundHalfBand(mean);
}

export interface SkillEstimateCore {
  estimated: number | null;
  previous: number | null;
  delta: number | null;
  trend: Trend;
  pointCount: number;
}

/**
 * Current estimate, the estimate one point earlier (so a trend is observable), and the trend.
 * `newestFirst` must be sorted by date, newest first.
 */
export function skillEstimate(newestFirst: number[], window = DEFAULT_WINDOW): SkillEstimateCore {
  const pointCount = newestFirst.length;
  const estimated = estimateFrom(newestFirst, window);
  if (pointCount < 2) return { estimated, previous: null, delta: null, trend: 'INSUFFICIENT_DATA', pointCount };
  const previous = estimateFrom(newestFirst.slice(1), window);
  if (estimated === null || previous === null) return { estimated, previous, delta: null, trend: 'INSUFFICIENT_DATA', pointCount };
  const delta = Math.round((estimated - previous) * 2) / 2;
  const trend: Trend = delta >= TREND_THRESHOLD ? 'IMPROVING' : delta <= -TREND_THRESHOLD ? 'DECLINING' : 'STABLE';
  return { estimated, previous, delta, trend, pointCount };
}

export interface OverallEstimate {
  overall: number | null;
  overallPrevious: number | null;
  overallTrend: Trend;
  overallStatus: 'OK' | 'INSUFFICIENT_DATA';
  missingSkills: Skill[];
}

/**
 * Overall band. Requires an estimate for every skill; otherwise `overall` is null and the
 * missing skills are named, so the UI can say why instead of showing a number.
 * Per-skill estimates are already half-band rounded; rounding their mean again is the IELTS
 * convention, so do not "fix" it into averaging raw scores.
 */
export function overallEstimate(skills: Record<Skill, SkillEstimateCore>): OverallEstimate {
  const missingSkills = SKILLS.filter((s) => skills[s].estimated === null);
  if (missingSkills.length > 0) {
    return { overall: null, overallPrevious: null, overallTrend: 'INSUFFICIENT_DATA', overallStatus: 'INSUFFICIENT_DATA', missingSkills };
  }
  const current = roundHalfBand(SKILLS.reduce((s, k) => s + skills[k].estimated!, 0) / SKILLS.length);
  const priorValues = SKILLS.map((k) => skills[k].previous);
  if (priorValues.some((p) => p === null)) {
    return { overall: current, overallPrevious: null, overallTrend: 'INSUFFICIENT_DATA', overallStatus: 'OK', missingSkills: [] };
  }
  const previous = roundHalfBand((priorValues as number[]).reduce((s, p) => s + p, 0) / SKILLS.length);
  const delta = Math.round((current - previous) * 2) / 2;
  const trend: Trend = delta >= TREND_THRESHOLD ? 'IMPROVING' : delta <= -TREND_THRESHOLD ? 'DECLINING' : 'STABLE';
  return { overall: current, overallPrevious: previous, overallTrend: trend, overallStatus: 'OK', missingSkills: [] };
}

/** Gap to target: target minus estimate, or null when either side is unknown. */
export const gapTo = (target: number | null, estimate: number | null): number | null =>
  target === null || estimate === null ? null : Math.round((target - estimate) * 2) / 2;
