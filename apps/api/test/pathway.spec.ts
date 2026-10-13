import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MASTERY_PERCENT, RecommendableItem, SkillStateResult, deriveSkillState, deriveSkillStates,
  isReviewDue, masteryState, recommendNext,
} from '../src/learning/pathway';

describe('masteryState', () => {
  it('is never mastered without a mastery-check attempt, however much was completed', () => {
    expect(masteryState({ bestMasteryCheckPercent: null })).toEqual({ mastered: false, reason: 'NO_MASTERY_CHECK' });
  });

  it('uses the default 80% threshold when the unit has no override', () => {
    expect(masteryState({ bestMasteryCheckPercent: 79 })).toMatchObject({ mastered: false, reason: 'BELOW_THRESHOLD', required: DEFAULT_MASTERY_PERCENT });
    expect(masteryState({ bestMasteryCheckPercent: 80 })).toEqual({ mastered: true, required: 80, scored: 80 });
  });

  it('honours a per-unit threshold override', () => {
    expect(masteryState({ masteryPercent: 90, bestMasteryCheckPercent: 85 })).toMatchObject({ mastered: false, required: 90 });
    expect(masteryState({ masteryPercent: 60, bestMasteryCheckPercent: 65 })).toEqual({ mastered: true, required: 60, scored: 65 });
  });
});

describe('deriveSkillState', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  const outcome = (correct: boolean, daysAgo: number) => ({ correct, at: new Date(now.getTime() - daysAgo * 86_400_000) });

  it('is UNKNOWN with no evidence at all', () => {
    expect(deriveSkillState({ skillKey: 'reading.matching_headings', outcomes: [] }, now)).toEqual({
      skillKey: 'reading.matching_headings', state: 'UNKNOWN', accuracyPercent: null, sampleSize: 0, lastEvidenceAt: null, reviewDueAt: null,
    });
  });

  it('does not call a skill STRONG from too little evidence, even at 100% accuracy', () => {
    const r = deriveSkillState({ skillKey: 's', outcomes: [outcome(true, 1), outcome(true, 2)] }, now);
    expect(r.state).toBe('DEVELOPING');
    expect(r.sampleSize).toBe(2);
  });

  it('is STRONG at or above 80% accuracy with enough evidence', () => {
    const outcomes = [outcome(true, 1), outcome(true, 2), outcome(true, 3), outcome(true, 4), outcome(false, 5)];
    const r = deriveSkillState({ skillKey: 's', outcomes }, now);
    expect(r).toMatchObject({ state: 'STRONG', accuracyPercent: 80, sampleSize: 5 });
  });

  it('is WEAK at or below 50% accuracy regardless of sample size', () => {
    const outcomes = [outcome(true, 1), outcome(false, 2)];
    expect(deriveSkillState({ skillKey: 's', outcomes }, now).state).toBe('WEAK');
  });

  it('flips a STRONG skill to NEEDS_REVIEW once its review window has passed', () => {
    const oldOutcomes = [outcome(true, 20), outcome(true, 21), outcome(true, 22), outcome(true, 23), outcome(true, 24)];
    const r = deriveSkillState({ skillKey: 's', outcomes: oldOutcomes }, now); // STRONG's interval is 14 days; evidence is 20+ days old
    expect(r.state).toBe('NEEDS_REVIEW');
    expect(isReviewDue(r.reviewDueAt, now)).toBe(true);
  });

  it('deriveSkillStates maps over several skills independently', () => {
    const results = deriveSkillStates([
      { skillKey: 'a', outcomes: [] },
      { skillKey: 'b', outcomes: [outcome(false, 1)] },
    ], now);
    expect(results.map((r) => r.skillKey)).toEqual(['a', 'b']);
    expect(results[0].state).toBe('UNKNOWN');
    expect(results[1].state).toBe('WEAK');
  });
});

describe('recommendNext', () => {
  const state = (skillKey: string, s: SkillStateResult['state']): SkillStateResult =>
    ({ skillKey, state: s, accuracyPercent: null, sampleSize: 0, lastEvidenceAt: null, reviewDueAt: null });
  const item = (id: string, activityKind: string, studentStatus?: RecommendableItem['studentStatus']): RecommendableItem =>
    ({ id, skillKey: 'reading.matching_headings', activityKind, recommendable: true, studentStatus });

  it('recommends the foundational lesson first for a weak, untouched skill', () => {
    const items = new Map([['reading.matching_headings', [item('lesson-1', 'LESSON'), item('practice-1', 'PRACTICE')]]]);
    const recs = recommendNext([state('reading.matching_headings', 'WEAK')], items);
    expect(recs).toEqual([{ contentItemId: 'lesson-1', skillKey: 'reading.matching_headings', reason: 'FOUNDATIONAL_LESSON' }]);
  });

  it('advances to the next stage once the earlier stage is already completed', () => {
    const items = new Map([['reading.matching_headings', [
      item('lesson-1', 'LESSON', 'COMPLETED'), item('example-1', 'WORKED_EXAMPLE', 'COMPLETED'), item('practice-1', 'GUIDED_EXERCISE'),
    ]]]);
    const recs = recommendNext([state('reading.matching_headings', 'DEVELOPING')], items);
    expect(recs).toEqual([{ contentItemId: 'practice-1', skillKey: 'reading.matching_headings', reason: 'GUIDED_EXERCISE' }]);
  });

  it('recommends revision, not remediation, for a skill that needs review', () => {
    const items = new Map([['reading.matching_headings', [item('lesson-1', 'LESSON'), item('revision-1', 'REVISION')]]]);
    const recs = recommendNext([state('reading.matching_headings', 'NEEDS_REVIEW')], items);
    expect(recs).toEqual([{ contentItemId: 'revision-1', skillKey: 'reading.matching_headings', reason: 'REVISION_DUE' }]);
  });

  it('never recommends anything for a STRONG or MASTERED skill with nothing due', () => {
    const items = new Map([['reading.matching_headings', [item('lesson-1', 'LESSON')]]]);
    expect(recommendNext([state('reading.matching_headings', 'STRONG')], items)).toEqual([]);
    expect(recommendNext([state('reading.matching_headings', 'MASTERED')], items)).toEqual([]);
  });

  it('skips a stage with no eligible item instead of crashing or recommending something unrelated', () => {
    const items = new Map([['reading.matching_headings', [item('practice-1', 'PRACTICE')]]]); // no LESSON/WORKED_EXAMPLE/GUIDED_EXERCISE at all
    const recs = recommendNext([state('reading.matching_headings', 'WEAK')], items);
    expect(recs).toEqual([{ contentItemId: 'practice-1', skillKey: 'reading.matching_headings', reason: 'INDEPENDENT_PRACTICE' }]);
  });
});
