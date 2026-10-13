/**
 * Adaptive learning pathway: pure functions over evidence the caller already has (recent
 * question outcomes, mastery-check scores, content taxonomy). No I/O — the service layer
 * reads the database, builds this evidence, and persists what these functions decide.
 *
 * Mirrors the style of ./release.ts: given data in, a plain decision out, nothing invented.
 */

export type SkillState = 'UNKNOWN' | 'WEAK' | 'DEVELOPING' | 'STRONG' | 'MASTERED' | 'NEEDS_REVIEW';

/** A unit is Mastered only when its mastery-check assessment clears this bar (spec §17–§18). */
export const DEFAULT_MASTERY_PERCENT = 80;

/** Below this many recent outcomes, there isn't enough evidence to call a skill STRONG or WEAK. */
const MIN_SAMPLE_FOR_VERDICT = 5;
const WEAK_ACCURACY_CEILING = 50;
const STRONG_ACCURACY_FLOOR = 80;

/** How long a skill stays "fresh" before it comes up for revision, by its current strength. */
const REVIEW_INTERVAL_DAYS: Record<SkillState, number | null> = {
  UNKNOWN: null,
  WEAK: 3,
  DEVELOPING: 7,
  STRONG: 14,
  MASTERED: 30,
  NEEDS_REVIEW: 3,
};
const DAY_MS = 86_400_000;

// ───────── mastery (content-item level) ─────────

export interface MasteryInput {
  /** The unit's own threshold, or null/undefined to use DEFAULT_MASTERY_PERCENT. */
  masteryPercent?: number | null;
  /** Best percent scored on this unit's mastery-check activity, or null if never attempted. */
  bestMasteryCheckPercent: number | null;
}

export type MasteryResult =
  | { mastered: false; reason: 'NO_MASTERY_CHECK' }
  | { mastered: false; reason: 'BELOW_THRESHOLD'; required: number; scored: number }
  | { mastered: true; required: number; scored: number };

/**
 * Completing a lesson is never enough on its own — mastery requires passing the unit's
 * mastery-check at or above its threshold (spec §18: "do not mark mastered merely because
 * its video was watched").
 */
export function masteryState(input: MasteryInput): MasteryResult {
  const required = input.masteryPercent ?? DEFAULT_MASTERY_PERCENT;
  if (input.bestMasteryCheckPercent === null) return { mastered: false, reason: 'NO_MASTERY_CHECK' };
  if (input.bestMasteryCheckPercent < required) {
    return { mastered: false, reason: 'BELOW_THRESHOLD', required, scored: input.bestMasteryCheckPercent };
  }
  return { mastered: true, required, scored: input.bestMasteryCheckPercent };
}

// ───────── skill state (aggregate, drives recommendations and insights) ─────────

export interface SkillOutcome {
  correct: boolean;
  at: Date;
}

export interface SkillEvidence {
  skillKey: string;
  module?: string | null;
  track?: string | null;
  /** Recent outcomes for this skill, any order — only their count and correctness are used. */
  outcomes: SkillOutcome[];
}

export interface SkillStateResult {
  skillKey: string;
  state: SkillState;
  accuracyPercent: number | null;
  sampleSize: number;
  lastEvidenceAt: Date | null;
  reviewDueAt: Date | null;
}

/**
 * Turns a skill's recent outcomes into a state. Never claims STRONG/WEAK from too little
 * evidence — with fewer than MIN_SAMPLE_FOR_VERDICT outcomes the verdict stays DEVELOPING
 * (or WEAK, if even the little evidence there is looks bad) rather than overclaiming.
 */
export function deriveSkillState(evidence: SkillEvidence, now: Date): SkillStateResult {
  const n = evidence.outcomes.length;
  if (n === 0) return { skillKey: evidence.skillKey, state: 'UNKNOWN', accuracyPercent: null, sampleSize: 0, lastEvidenceAt: null, reviewDueAt: null };

  const correct = evidence.outcomes.filter((o) => o.correct).length;
  const accuracyPercent = Math.round((correct / n) * 10_000) / 100;
  const lastEvidenceAt = evidence.outcomes.reduce((latest, o) => (o.at > latest ? o.at : latest), evidence.outcomes[0].at);

  let state: SkillState;
  if (accuracyPercent <= WEAK_ACCURACY_CEILING) state = 'WEAK';
  else if (n >= MIN_SAMPLE_FOR_VERDICT && accuracyPercent >= STRONG_ACCURACY_FLOOR) state = 'STRONG';
  else state = 'DEVELOPING';

  const intervalDays = REVIEW_INTERVAL_DAYS[state];
  const reviewDueAt = intervalDays === null ? null : new Date(lastEvidenceAt.getTime() + intervalDays * DAY_MS);
  // A STRONG skill whose review window has already passed is due for revision now, not later.
  if (state === 'STRONG' && reviewDueAt && reviewDueAt <= now) state = 'NEEDS_REVIEW';

  return { skillKey: evidence.skillKey, state, accuracyPercent, sampleSize: n, lastEvidenceAt, reviewDueAt };
}

export const deriveSkillStates = (evidence: SkillEvidence[], now: Date): SkillStateResult[] => evidence.map((e) => deriveSkillState(e, now));

/** Whether a previously computed review date has come due. */
export const isReviewDue = (reviewDueAt: Date | null, now: Date): boolean => reviewDueAt !== null && reviewDueAt <= now;

// ───────── recommendations ─────────

export type RecommendationReason = 'FOUNDATIONAL_LESSON' | 'WORKED_EXAMPLE' | 'GUIDED_EXERCISE' | 'INDEPENDENT_PRACTICE' | 'MASTERY_CHECK' | 'REVISION_DUE';

export interface RecommendableItem {
  id: string;
  skillKey: string | null;
  activityKind: string; // LESSON | WORKED_EXAMPLE | GUIDED_EXERCISE | PRACTICE | TIMED_PRACTICE | MASTERY_CHECK | PROMPT | REVISION
  recommendable: boolean;
  /** Completed/mastered state the student already has for this exact item, if any. */
  studentStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'MASTERED';
}

export interface Recommendation {
  contentItemId: string;
  skillKey: string;
  reason: RecommendationReason;
}

const STAGE_ORDER: RecommendationReason[] = ['FOUNDATIONAL_LESSON', 'WORKED_EXAMPLE', 'GUIDED_EXERCISE', 'INDEPENDENT_PRACTICE', 'MASTERY_CHECK'];
const KIND_TO_STAGE: Record<string, RecommendationReason | undefined> = {
  LESSON: 'FOUNDATIONAL_LESSON',
  WORKED_EXAMPLE: 'WORKED_EXAMPLE',
  GUIDED_EXERCISE: 'GUIDED_EXERCISE',
  PRACTICE: 'INDEPENDENT_PRACTICE',
  TIMED_PRACTICE: 'INDEPENDENT_PRACTICE',
  MASTERY_CHECK: 'MASTERY_CHECK',
};

/**
 * One recommendation per weak/developing/needs-review skill: the next item in that skill's
 * stage order the student has not already completed. A STRONG or MASTERED skill with nothing
 * due for review gets no recommendation — students are not forced through remediation once
 * they've shown they don't need it (spec §17: "allow them to progress").
 */
export function recommendNext(skillStates: SkillStateResult[], itemsBySkill: Map<string, RecommendableItem[]>): Recommendation[] {
  const out: Recommendation[] = [];
  for (const s of skillStates) {
    if (s.state === 'STRONG' || s.state === 'MASTERED') continue;
    const candidates = (itemsBySkill.get(s.skillKey) ?? []).filter((i) => i.recommendable);
    if (s.state === 'NEEDS_REVIEW') {
      const revision = candidates.find((i) => i.activityKind === 'REVISION') ?? candidates.find((i) => KIND_TO_STAGE[i.activityKind] === 'INDEPENDENT_PRACTICE');
      if (revision) out.push({ contentItemId: revision.id, skillKey: s.skillKey, reason: 'REVISION_DUE' });
      continue;
    }
    for (const stage of STAGE_ORDER) {
      const next = candidates.find((i) => KIND_TO_STAGE[i.activityKind] === stage && i.studentStatus !== 'COMPLETED' && i.studentStatus !== 'MASTERED');
      if (next) {
        out.push({ contentItemId: next.id, skillKey: s.skillKey, reason: stage });
        break; // one recommendation per skill, at its current stage
      }
    }
  }
  return out;
}
