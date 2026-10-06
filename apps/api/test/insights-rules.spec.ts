import { describe, expect, it } from 'vitest';
import { allocate, Candidate, planStatus } from '../src/study-plan/allocator';
import { categorize, monthlyTrend } from '../src/grammar/categorize';
import { classify, criterionWeakness, DEFAULT_WEAKNESS_THRESHOLDS, groupAccuracy, weaknessReport, AnsweredItem } from '../src/insights/weakness';
import { DEFAULT_READINESS_WEIGHTS, readiness, ReadinessSignals, spreadOf } from '../src/insights/readiness';
import { combinationsFor, planFor } from '../src/insights/target-band';
import { correctRate, reviewCard } from '../src/vocabulary/sm2';
import { fluencyOf, profileOf } from '../src/speaking/fluency';

/** Pure rules for student intelligence. No database, no clock. */

const T = DEFAULT_WEAKNESS_THRESHOLDS;
const item = (over: Partial<AnsweredItem>): AnsweredItem => ({ skill: 'READING', ieltsType: 'TFNG', topic: 'travel', difficulty: 3, section: 1, isCorrect: true, ...over });

describe('weakness classification', () => {
  it('refuses to judge a group with too few answers', () => {
    expect(classify(3, 0, T).level).toBe('INSUFFICIENT_DATA');
  });
  it('places accuracy into high risk, needs practice and strong', () => {
    expect(classify(10, 4, T).level).toBe('HIGH_RISK');
    expect(classify(10, 6, T).level).toBe('NEEDS_PRACTICE');
    expect(classify(10, 9, T).level).toBe('STRONG');
  });
  it('sorts the weakest well-sampled group first', () => {
    const items = [
      ...Array.from({ length: 6 }, (_, i) => item({ ieltsType: 'TFNG', isCorrect: i < 2 })),
      ...Array.from({ length: 6 }, (_, i) => item({ ieltsType: 'MCQ_SINGLE', isCorrect: i < 5 })),
    ];
    const groups = groupAccuracy(items, (i) => i.ieltsType, T);
    expect(groups[0].key).toBe('TFNG');
    expect(groups[0].level).toBe('HIGH_RISK');
  });
  it('builds every breakdown the dashboard shows', () => {
    const r = weaknessReport([item({})], T);
    expect(Object.keys(r).sort()).toEqual(['byDifficulty', 'byQuestionType', 'bySection', 'bySkill', 'byTopic']);
  });
  it('a criterion is weak when it trails the target by more than half a band', () => {
    const r = criterionWeakness([{ key: 'GRAMMAR', score: 5 }, { key: 'LEXICAL', score: 6.5 }, { key: 'COHERENCE', score: null }], 7);
    expect(r.find((x) => x.key === 'GRAMMAR')?.level).toBe('HIGH_RISK');
    expect(r.find((x) => x.key === 'LEXICAL')?.level).toBe('NEEDS_PRACTICE');
    expect(r.find((x) => x.key === 'COHERENCE')?.level).toBe('INSUFFICIENT_DATA');
  });
});

describe('readiness', () => {
  const base: ReadinessSignals = {
    recentScores: [{ skill: 'READING', band: 7 }, { skill: 'READING', band: 7 }, { skill: 'WRITING', band: 5.5 }, { skill: 'WRITING', band: 5.5 }, { skill: 'WRITING', band: 5.5 }],
    target: 7, mockCountLast60Days: 3, bandSpread: 0.4, completion: 0.9, attendance: 0.95, assignments: 1,
    skillEstimates: { LISTENING: 7, READING: 7, WRITING: 5.5, SPEAKING: 6.5 }, trend: 'IMPROVING',
  };
  it('returns a percentage labelled as an estimate', () => {
    const r = readiness(base);
    expect(r.percent).toBeGreaterThanOrEqual(0);
    expect(r.percent).toBeLessThanOrEqual(100);
    expect(r.label).toBe('Readiness estimate');
  });
  it('explains why readiness is lower, naming the skill below target', () => {
    const r = readiness(base);
    expect(r.reasons.join(' ')).toMatch(/Your readiness is lower because Writing has remained below your target/);
  });
  it('a student with no mocks is told so', () => {
    expect(readiness({ ...base, mockCountLast60Days: 0 }).reasons.join(' ')).toMatch(/No mock test/);
  });
  it('more signals in good shape raise the score', () => {
    const low = readiness({ ...base, attendance: 0.4, completion: 0.2, assignments: 0.2, trend: 'DECLINING' }).percent;
    const high = readiness(base).percent;
    expect(high).toBeGreaterThan(low);
  });
  it('weights add up to one', () => {
    expect(Object.values(DEFAULT_READINESS_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });
  it('standard deviation needs at least two values', () => {
    expect(spreadOf([6])).toBeNull();
    expect(spreadOf([6, 6])).toBe(0);
  });
});

describe('target band planning', () => {
  const current = { LISTENING: 6.5, READING: 6, WRITING: 5.5, SPEAKING: 6 };
  it('every combination reaches the target and needs no more than two bands per skill', () => {
    const combos = combinationsFor({ current, target: 7 });
    expect(combos.length).toBeGreaterThan(0);
    for (const c of combos) {
      expect(c.overall).toBeGreaterThanOrEqual(7);
      for (const k of Object.keys(current) as (keyof typeof current)[]) expect(c.scores[k] - current[k]).toBeLessThanOrEqual(2 + 1e-9);
    }
  });
  it('the cheapest combination is ranked first', () => {
    const combos = combinationsFor({ current, target: 7 });
    for (let i = 1; i < combos.length; i++) expect(combos[i].cost).toBeGreaterThanOrEqual(combos[i - 1].cost);
  });
  it('names the biggest gap and labels the output as planning guidance', () => {
    const plan = planFor({ current, target: 7, weeksToExam: 8 });
    expect(plan.biggestGap?.skill).toBe('WRITING');
    expect(plan.labelled).toMatch(/Planning guidance/);
    expect(plan.weeklyImprovementTarget).toBeGreaterThan(0);
  });
  it('gives no overall estimate when a skill is unknown', () => {
    expect(planFor({ current: { ...current, SPEAKING: null }, target: 7, weeksToExam: 8 }).current.overallEstimate).toBeNull();
  });
});

describe('spaced review', () => {
  const now = new Date('2026-10-06T10:00:00Z');
  const fresh = { ease: 2.5, intervalDays: 0, reviewCount: 0, correctCount: 0 };
  it('a correct first review comes back tomorrow', () => {
    const n = reviewCard(fresh, true, now);
    expect(n.intervalDays).toBe(1);
    expect(n.nextReviewAt.getTime() - now.getTime()).toBe(86_400_000);
  });
  it('intervals lengthen as the card is remembered', () => {
    const after2 = { ease: 2.6, intervalDays: 3, reviewCount: 2, correctCount: 2 };
    expect(reviewCard(after2, true, now).intervalDays).toBeGreaterThan(3);
  });
  it('a miss brings the card back tomorrow and lowers ease, never below the floor', () => {
    const n = reviewCard({ ease: 1.35, intervalDays: 10, reviewCount: 5, correctCount: 4 }, false, now);
    expect(n.intervalDays).toBe(1);
    expect(n.ease).toBeGreaterThanOrEqual(1.3);
    expect(n.status).toBe('NEED_PRACTICE');
  });
  it('a card becomes mastered only after a long interval and a run of correct answers', () => {
    const n = reviewCard({ ease: 2.8, intervalDays: 12, reviewCount: 6, correctCount: 5 }, true, now);
    expect(n.status).toBe('MASTERED');
  });
  it('the correct rate is null before any review', () => {
    expect(correctRate(0, 0)).toBeNull();
    expect(correctRate(4, 3)).toBe(0.75);
  });
});

describe('grammar categories', () => {
  it('maps common notes onto fixed categories', () => {
    expect(categorize('Use the definite article before this noun.')).toBe('ARTICLES');
    expect(categorize('Past simple is needed here, not present perfect.')).toBe('TENSES');
    expect(categorize('Subject-verb agreement: the subject is singular.')).toBe('SUBJECT_VERB');
    expect(categorize('This is a comma splice.')).toBe('RUN_ONS');
  });
  it('a note that matches nothing goes to OTHER rather than being guessed', () => {
    expect(categorize('Sounds unnatural to me.')).toBe('OTHER');
  });
  it('reports the month-on-month change', () => {
    expect(monthlyTrend(18, 12)).toEqual({ direction: 'UP', percent: 50 });
    expect(monthlyTrend(7, 10)).toEqual({ direction: 'DOWN', percent: 30 });
    expect(monthlyTrend(3, 0)).toEqual({ direction: 'NEW', percent: null });
  });
});

describe('speaking fluency', () => {
  it('computes words per minute from duration and counts fillers and repeats', () => {
    const f = fluencyOf('um I I think that um the city is nice', 12);
    expect(f.wordsPerMinute).toBe(Math.round((f.words / 0.2) * 10) / 10);
    expect(f.fillerCount).toBe(2);
    expect(f.repeatedWords).toBe(1);
  });
  it('marks vocabulary diversity as unreliable for short answers', () => {
    expect(fluencyOf('a short answer here', 5).vocabularyDiversity.reliable).toBe(false);
  });
  it('always states that the metrics are supporting indicators', () => {
    expect(fluencyOf('hello', 2).note).toMatch(/Supporting indicators/);
    expect(profileOf([fluencyOf('hello there', 2)]).note).toMatch(/Supporting indicators/);
  });
});

describe('study plan allocation', () => {
  const cands: Candidate[] = [
    { key: 'a', skill: 'WRITING', kind: 'practice', refType: 'WRITING_TASK', refId: '1', title: 'A', minutes: 30, weight: 5, rationale: 'x' },
    { key: 'b', skill: 'READING', kind: 'practice', refType: 'QUESTION_SET', refId: '2', title: 'B', minutes: 30, weight: 4, rationale: 'x' },
    { key: 'c', skill: 'SPEAKING', kind: 'practice', refType: 'SPEAKING_PART', refId: '3', title: 'C', minutes: 40, weight: 3, rationale: 'x' },
    { key: 'd', skill: 'VOCABULARY', kind: 'review', refType: 'VOCABULARY_REVIEW', refId: '4', title: 'D', minutes: 15, weight: 1, rationale: 'x' },
  ];
  it('never puts more minutes on a day than the limit', () => {
    for (const day of allocate(cands, 5, 60)) expect(day.minutes).toBeLessThanOrEqual(60);
  });
  it('places each task at most once', () => {
    const placed = allocate(cands, 5, 60).flatMap((d) => d.tasks.map((t) => t.key));
    expect(new Set(placed).size).toBe(placed.length);
  });
  it('is deterministic', () => {
    expect(allocate(cands, 5, 60)).toEqual(allocate(cands, 5, 60));
  });
  it('heaviest needs are scheduled first', () => {
    const first = allocate(cands, 5, 60)[0].tasks.map((t) => t.key);
    expect(first).toContain('a');
  });
  it('states whether the plan covers the gap', () => {
    expect(planStatus({ gapBands: 0, daysLeft: 30, minutesPlanned: 0, minutesPerDay: 60 })).toBe('ON_TRACK');
    expect(planStatus({ gapBands: 2, daysLeft: 30, minutesPlanned: 60, minutesPerDay: 60 })).toBe('NEEDS_IMPROVEMENT');
    expect(planStatus({ gapBands: null, daysLeft: 30, minutesPlanned: 0, minutesPerDay: 60 })).toBe('NO_TARGET');
  });
});
