/**
 * Weakness analysis as pure functions. Thresholds are configuration (setting insights.weakness.thresholds),
 * so a rule can be tuned without a deploy. Nothing here touches the database or the clock.
 */

export interface WeaknessThresholds {
  /** Accuracy below this is HIGH_RISK (0–1). */
  highRiskBelow: number;
  /** Accuracy below this is NEEDS_PRACTICE. */
  needsPracticeBelow: number;
  /** Fewer answers than this and the group is INSUFFICIENT_DATA rather than judged. */
  minSample: number;
}

export const DEFAULT_WEAKNESS_THRESHOLDS: WeaknessThresholds = { highRiskBelow: 0.5, needsPracticeBelow: 0.7, minSample: 5 };

export type WeaknessLevel = 'HIGH_RISK' | 'NEEDS_PRACTICE' | 'STRONG' | 'INSUFFICIENT_DATA';

export interface AnsweredItem {
  skill: string;
  ieltsType: string | null;
  topic: string | null;
  difficulty: number;
  section: number | null;
  isCorrect: boolean;
}

export interface Group { key: string; total: number; correct: number; accuracy: number | null; level: WeaknessLevel }

export function classify(total: number, correct: number, t: WeaknessThresholds): { accuracy: number | null; level: WeaknessLevel } {
  if (total < t.minSample) return { accuracy: total === 0 ? null : correct / total, level: 'INSUFFICIENT_DATA' };
  const accuracy = correct / total;
  if (accuracy < t.highRiskBelow) return { accuracy, level: 'HIGH_RISK' };
  if (accuracy < t.needsPracticeBelow) return { accuracy, level: 'NEEDS_PRACTICE' };
  return { accuracy, level: 'STRONG' };
}

/** Accuracy per group, weakest first (groups without enough data sort last). */
export function groupAccuracy(items: AnsweredItem[], keyOf: (i: AnsweredItem) => string | null, t: WeaknessThresholds): Group[] {
  const map = new Map<string, { total: number; correct: number }>();
  for (const i of items) {
    const k = keyOf(i);
    if (!k) continue;
    const g = map.get(k) ?? { total: 0, correct: 0 };
    g.total++;
    if (i.isCorrect) g.correct++;
    map.set(k, g);
  }
  const rank: Record<WeaknessLevel, number> = { HIGH_RISK: 0, NEEDS_PRACTICE: 1, STRONG: 2, INSUFFICIENT_DATA: 3 };
  return [...map.entries()]
    .map(([key, g]) => ({ key, total: g.total, correct: g.correct, ...classify(g.total, g.correct, t) }))
    .sort((a, b) => rank[a.level] - rank[b.level] || (a.accuracy ?? 1) - (b.accuracy ?? 1) || a.key.localeCompare(b.key));
}

export function weaknessReport(items: AnsweredItem[], t: WeaknessThresholds) {
  return {
    bySkill: groupAccuracy(items, (i) => i.skill, t),
    byQuestionType: groupAccuracy(items, (i) => i.ieltsType, t),
    byTopic: groupAccuracy(items, (i) => i.topic, t),
    byDifficulty: groupAccuracy(items, (i) => `Level ${i.difficulty}`, t),
    bySection: groupAccuracy(items, (i) => (i.section === null ? null : `Section ${i.section}`), t),
  };
}

/** Writing and speaking: a criterion is weak when its latest score is below the target by more than half a band. */
export function criterionWeakness(scores: { key: string; score: number | null }[], target: number | null) {
  return scores.map((s) => {
    if (s.score === null) return { key: s.key, score: null, level: 'INSUFFICIENT_DATA' as WeaknessLevel, gap: null };
    const gap = target === null ? null : Math.round((target - s.score) * 2) / 2;
    const level: WeaknessLevel = gap === null ? 'STRONG' : gap > 1 ? 'HIGH_RISK' : gap > 0 ? 'NEEDS_PRACTICE' : 'STRONG';
    return { key: s.key, score: s.score, level, gap };
  });
}

/** Plain words for a level, used in every place a weakness is shown. */
export const LEVEL_LABEL: Record<WeaknessLevel, string> = {
  HIGH_RISK: 'High risk',
  NEEDS_PRACTICE: 'Needs practice',
  STRONG: 'Strong',
  INSUFFICIENT_DATA: 'Not enough data yet',
};
