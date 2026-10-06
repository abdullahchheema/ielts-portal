/**
 * Target band planning. Pure. Every output is planning guidance, not a prediction.
 * Skill combinations use the same half-band rounding as the rest of the platform.
 */
import { roundHalfBand } from '../analytics/band';

export const SKILLS = ['LISTENING', 'READING', 'WRITING', 'SPEAKING'] as const;
export type Skill = (typeof SKILLS)[number];

export interface TargetInput {
  current: Record<Skill, number | null>;
  target: number;
  weeksToExam: number | null;
  /** Higher weight means that skill matters more to the student's goal (default 1). */
  priorities?: Partial<Record<Skill, number>>;
}

export interface Combination { scores: Record<Skill, number>; cost: number; overall: number }

const HALF_STEPS = (from: number, to: number) => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += 0.5) out.push(Math.round(v * 2) / 2);
  return out;
};

/**
 * Half-band combinations of the four skills whose overall (the rounded mean) reaches the target, each skill
 * no more than two bands above its current estimate. Ranked by how much improvement they need, weighted by priority.
 */
export function combinationsFor(input: TargetInput, limit = 5): Combination[] {
  const pri = (k: Skill) => input.priorities?.[k] ?? 1;
  const base = (k: Skill) => input.current[k] ?? 0;
  const options = SKILLS.map((k) => HALF_STEPS(base(k), Math.min(9, base(k) + 2)));
  const results: Combination[] = [];
  const pick: number[] = [];
  const walk = (i: number) => {
    if (i === SKILLS.length) {
      const scores = Object.fromEntries(SKILLS.map((k, j) => [k, pick[j]])) as Record<Skill, number>;
      const overall = roundHalfBand(SKILLS.reduce((s, k) => s + scores[k], 0) / SKILLS.length);
      if (overall >= input.target) {
        const cost = SKILLS.reduce((s, k) => s + Math.max(0, scores[k] - base(k)) * pri(k), 0);
        results.push({ scores, cost: Math.round(cost * 10) / 10, overall });
      }
      return;
    }
    for (const v of options[i]) {
      pick[i] = v;
      walk(i + 1);
    }
  };
  walk(0);
  return results.sort((a, b) => a.cost - b.cost || a.overall - b.overall).slice(0, limit);
}

export function planFor(input: TargetInput) {
  const known = SKILLS.filter((k) => input.current[k] !== null);
  const estimate = known.length === SKILLS.length
    ? roundHalfBand(SKILLS.reduce((s, k) => s + (input.current[k] as number), 0) / SKILLS.length)
    : null;
  const gaps = SKILLS.map((k) => ({
    skill: k,
    current: input.current[k],
    gap: input.current[k] === null ? null : Math.round((input.target - (input.current[k] as number)) * 2) / 2,
  }));
  const biggest = gaps.filter((g) => g.gap !== null).sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0))[0] ?? null;
  const overallGap = estimate === null ? null : Math.round((input.target - estimate) * 2) / 2;
  const weekly = overallGap !== null && input.weeksToExam && input.weeksToExam > 0
    ? Math.round((Math.max(0, overallGap) / input.weeksToExam) * 100) / 100
    : null;
  return {
    labelled: 'Planning guidance. These are estimates and calculations, not predictions of your result.',
    current: { overallEstimate: estimate, skills: input.current },
    target: input.target,
    gaps,
    biggestGap: biggest ? { skill: biggest.skill, gap: biggest.gap } : null,
    weeklyImprovementTarget: weekly,
    combinations: combinationsFor(input),
  };
}
