import { describe, expect, it } from 'vitest';
import { evaluateRelease, progressPercent } from '../src/learning/release';

const now = new Date('2026-10-10T12:00:00Z');
const batchStartAt = new Date('2026-10-01T00:00:00Z');
const ctx = (completed: string[] = [], published: string[] = ['a', 'b']) => ({
  now, batchStartAt, completedItemIds: new Set(completed), publishedItemIds: new Set(published),
});

describe('evaluateRelease', () => {
  it('IMMEDIATE is always open', () => {
    expect(evaluateRelease({ releaseType: 'IMMEDIATE', releaseValue: null }, ctx())).toEqual({ unlocked: true });
  });

  it('BATCH_DATE opens on/after the date', () => {
    expect(evaluateRelease({ releaseType: 'BATCH_DATE', releaseValue: { date: '2026-10-10T12:00:00Z' } }, ctx())).toEqual({ unlocked: true });
    const r = evaluateRelease({ releaseType: 'BATCH_DATE', releaseValue: { date: '2026-10-15T00:00:00Z' } }, ctx());
    expect(r).toMatchObject({ unlocked: false, code: 'CONTENT_NOT_RELEASED' });
  });

  it('RELATIVE counts days from the batch start', () => {
    expect(evaluateRelease({ releaseType: 'RELATIVE', releaseValue: { days: 7 } }, ctx())).toEqual({ unlocked: true });
    const r = evaluateRelease({ releaseType: 'RELATIVE', releaseValue: { days: 14 } }, ctx());
    expect(r).toMatchObject({ unlocked: false, code: 'CONTENT_NOT_RELEASED', availableAt: new Date('2026-10-15T00:00:00Z') });
  });

  it('PREREQUISITE needs the required item completed', () => {
    const item = { releaseType: 'PREREQUISITE' as const, releaseValue: { requiredItemId: 'a' } };
    expect(evaluateRelease(item, ctx(['a']))).toEqual({ unlocked: true });
    expect(evaluateRelease(item, ctx([]))).toMatchObject({ unlocked: false, code: 'PREREQUISITE_REQUIRED', requiredItemId: 'a' });
  });

  it('PREREQUISITE stays locked if the required item is missing or unpublished', () => {
    const item = { releaseType: 'PREREQUISITE' as const, releaseValue: { requiredItemId: 'gone' } };
    expect(evaluateRelease(item, ctx(['gone']))).toMatchObject({ unlocked: false, code: 'PREREQUISITE_REQUIRED' });
    expect(evaluateRelease({ releaseType: 'PREREQUISITE', releaseValue: null }, ctx())).toMatchObject({ unlocked: false });
  });

  it('misconfigured date rules fail closed', () => {
    expect(evaluateRelease({ releaseType: 'BATCH_DATE', releaseValue: {} }, ctx())).toMatchObject({ unlocked: false });
    expect(evaluateRelease({ releaseType: 'BATCH_DATE', releaseValue: { date: 'garbage' } }, ctx())).toMatchObject({ unlocked: false });
    expect(evaluateRelease({ releaseType: 'RELATIVE', releaseValue: {} }, ctx())).toMatchObject({ unlocked: false });
  });

  it('SCORE_BASED and MANUAL are locked until their features ship', () => {
    expect(evaluateRelease({ releaseType: 'SCORE_BASED', releaseValue: { minScorePercent: 70 } }, ctx())).toMatchObject({ unlocked: false, code: 'CONTENT_LOCKED' });
    expect(evaluateRelease({ releaseType: 'MANUAL', releaseValue: null }, ctx())).toMatchObject({ unlocked: false, code: 'CONTENT_LOCKED' });
  });
});

describe('progressPercent', () => {
  it('is completed required / total required', () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(1, 3)).toBe(33.33);
    expect(progressPercent(2, 3)).toBe(66.67);
    expect(progressPercent(3, 3)).toBe(100);
  });
});
